<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\OrgUnit;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Models\User;
use App\Models\UserPermission;
use App\Services\Access\RoleManager;
use App\Services\Groups\AutoGroupSync;
use App\Services\Mesh\MeshKeyring;
use App\Support\Access;
use App\Support\PermissionCatalog;
use Carbon\Carbon;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The members list and each member's page: their roles (with area and end date), single permissions
 * given or taken away, and what that adds up to. Everything is limited to the areas the admin covers.
 */
class MemberAccessController extends Controller
{
    public function __construct(private readonly RoleManager $roles) {}

    public function index(Request $request): Response
    {
        $me = $request->user();
        $units = Access::units($me, 'members.view');
        $q = User::inInstitution($me->institution_id)->whereIn('status', ['active', 'suspended'])->where('member_type', '!=', 'relay')
            ->with(['department', 'adminUnit'])->orderBy('name');
        if ($units !== null) {
            $q->where(fn ($w) => $w->whereIn('department_unit_id', $units ?: [0])->orWhereIn('faculty_unit_id', $units ?: [0])->orWhereIn('admin_unit_id', $units ?: [0]));
        }
        if ($s = trim((string) $request->query('q'))) {
            $q->where(fn ($w) => $w->where('name', 'like', '%'.addcslashes(mb_substr((string) $s, 0, 80), '%_\\').'%')->orWhere('identifier', $s)->orWhere('email', $s));
        }
        if ($type = $request->query('type')) {
            $q->where('member_type', $type);
        }
        if ($roleId = (int) $request->query('role')) {
            $q->whereIn('id', RoleAssignment::where('role_id', $roleId)->active()->select('user_id'));
        }
        if ($unit = (int) $request->query('unit')) {
            $inside = Access::descendants($me->institution_id, $unit);
            $q->where(fn ($w) => $w->whereIn('department_unit_id', $inside)->orWhereIn('faculty_unit_id', $inside)->orWhereIn('admin_unit_id', $inside));
        }
        $page = $q->paginate(30)->withQueryString();

        return Inertia::render('Admin/Members', [
            'members' => $page->through(fn (User $u) => [
                'id' => $u->id, 'name' => $u->name, 'identifier' => $u->identifier, 'title' => $u->title,
                'member_type' => $u->member_type, 'department' => $u->department?->name ?? $u->adminUnit?->name, 'level' => $u->member_type === 'student' ? $u->level : null,
                'alumni_year' => $u->alumni_year, 'alumni_year_kind' => $u->alumni_year_kind,
                'status' => $u->status, 'is_minor' => $u->is_minor, 'guardian_consent' => (bool) $u->guardian_consent_at,
                'last_seen_at' => $u->last_seen_at?->toIso8601String(),
            ]),
            'roles' => Role::orderBy('rank')->get(['id', 'name']),
            'units' => $this->unitOptions($me, 'members.view'),
            'filters' => $request->only(['q', 'type', 'role', 'unit']),
        ]);
    }

    public function show(Request $request, int $id): Response
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.view');
        $assignments = RoleAssignment::with(['role', 'unit', 'grantor:id,name'])->where('user_id', $member->id)->orderByDesc('id')->get();
        $direct = UserPermission::with(['unit', 'grantor:id,name'])->where('user_id', $member->id)->orderByDesc('id')->get();
        $catalog = PermissionCatalog::all();

        $effective = [];
        Access::forget($member->id);
        foreach (PermissionCatalog::GROUPS as $g => $group) {
            foreach ($group['items'] as $key => $def) {
                if (! Access::can($member, $key)) {
                    continue;
                }
                $units = PermissionCatalog::isArea($key) ? Access::units($member, $key) : null;
                $effective[] = ['key' => $key, 'label' => $def['label'], 'group' => $group['label'],
                    'where' => $units === null ? 'Everywhere' : $this->describeUnits($member->institution_id, $units)];
            }
        }
        $defaultRole = Role::where('default_for', $member->member_type)->first();

        return Inertia::render('Admin/MemberShow', [
            'member' => [
                'id' => $member->id, 'name' => $member->name, 'identifier' => $member->identifier, 'title' => $member->title,
                'email' => Access::canOnUser($me, 'members.contact', $member) ? $member->email : null,
                'phone' => Access::canOnUser($me, 'members.contact', $member) ? $member->phone : null,
                'member_type' => $member->member_type, 'status' => $member->status, 'level' => $member->level,
                'faculty' => $member->faculty?->name, 'department' => $member->department?->name, 'admin_unit' => $member->adminUnit?->name,
                'programme' => $member->programme, 'residence' => $member->residence,
                'is_minor' => $member->is_minor, 'guardian_consent' => (bool) $member->guardian_consent_at,
                'last_seen_at' => $member->last_seen_at?->toIso8601String(), 'auth_source' => $member->auth_source,
                'is_super' => Access::isSuper($member),
            ],
            'defaultRole' => $defaultRole ? ['id' => $defaultRole->id, 'name' => $defaultRole->name] : null,
            'assignments' => $assignments->map(fn (RoleAssignment $a) => [
                'id' => $a->id, 'role' => $a->role?->name, 'role_id' => $a->role_id, 'is_super' => (bool) $a->role?->is_super,
                'area' => $a->unit?->name, 'area_id' => $a->org_unit_id,
                'expires_at' => $a->expires_at?->toDateString(), 'expired' => $a->expires_at?->isPast() ?? false,
                'source' => $a->source, 'granted_by' => $a->grantor?->name, 'note' => $a->note,
                'can_remove' => $a->role && $this->roles->canGiveRole($me, $a->role, $a->org_unit_id),
            ]),
            'direct' => $direct->map(fn (UserPermission $p) => [
                'id' => $p->id, 'permission' => $p->permission, 'label' => $catalog[$p->permission]['label'] ?? $p->permission,
                'effect' => $p->effect, 'area' => $p->unit?->name, 'expires_at' => $p->expires_at?->toDateString(),
                'expired' => $p->expires_at?->isPast() ?? false, 'granted_by' => $p->grantor?->name, 'note' => $p->note,
                'can_remove' => $this->roles->canGivePermission($me, $p->permission, $p->org_unit_id),
            ]),
            'effective' => $effective,
            'roles' => Role::with('permissions')->whereNull('default_for')->orderBy('rank')->get()
                ->map(fn (Role $r) => ['id' => $r->id, 'name' => $r->name, 'description' => $r->description, 'is_super' => $r->is_super,
                    'needs_area' => false, 'permission_count' => $r->is_super ? count($catalog) : $r->permissions->count()]),
            'catalog' => PermissionCatalog::forClient(),
            'units' => $this->unitOptions($me, 'roles.assign', 'permissions.assign'),
            'can' => [
                'assign_roles' => Access::can($me, 'roles.assign') || Access::isSuper($me),
                'assign_everywhere' => Access::canEverywhere($me, 'roles.assign') || Access::isSuper($me),
                'assign_permissions' => Access::can($me, 'permissions.assign') || Access::isSuper($me),
                'suspend' => Access::canOnUser($me, 'members.suspend', $member) && $member->id !== $me->id,
                'consent' => $member->is_minor && ! $member->guardian_consent_at && Access::canOnUser($me, 'members.consent', $member),
            ],
        ]);
    }

    public function assignRole(Request $request, int $id): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.view');
        $data = $request->validate(['role_id' => 'required|integer', 'unit_id' => 'nullable|integer', 'expires_at' => 'nullable|date|after:today',
            'note' => 'nullable|string|max:300']);
        $role = Role::findOrFail($data['role_id']);
        $unit = $data['unit_id'] ? OrgUnit::findOrFail($data['unit_id'])->id : null;
        $this->roles->assign($me, $member, $role, $unit, isset($data['expires_at']) ? Carbon::parse($data['expires_at'])->endOfDay() : null, $data['note'] ?? null);

        return back()->with('status', "{$member->name} is now {$role->name}".($unit ? ' for '.OrgUnit::find($unit)->name : ' for the whole institution').'.');
    }

    public function removeRole(Request $request, int $id, int $assignmentId): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.view');
        $assignment = RoleAssignment::where('user_id', $member->id)->findOrFail($assignmentId);
        $name = $assignment->role?->name;
        $this->roles->unassign($me, $assignment);

        return back()->with('status', "Removed {$name} from {$member->name}.");
    }

    public function grantPermission(Request $request, int $id): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.view');
        $data = $request->validate(['permission' => 'required|string', 'effect' => 'required|in:grant,deny', 'unit_id' => 'nullable|integer',
            'expires_at' => 'nullable|date|after:today', 'note' => 'nullable|string|max:300']);
        $unit = $data['unit_id'] ? OrgUnit::findOrFail($data['unit_id'])->id : null;
        $this->roles->grantPermission($me, $member, $data['permission'], $data['effect'], $unit,
            isset($data['expires_at']) ? Carbon::parse($data['expires_at'])->endOfDay() : null, $data['note'] ?? null);
        $label = PermissionCatalog::all()[$data['permission']]['label'] ?? $data['permission'];

        return back()->with('status', ($data['effect'] === 'deny' ? 'Took away' : 'Gave')." \"{$label}\" ".($data['effect'] === 'deny' ? 'from' : 'to')." {$member->name}.");
    }

    public function removePermission(Request $request, int $id, int $permissionId): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.view');
        $this->roles->removePermission($me, UserPermission::where('user_id', $member->id)->findOrFail($permissionId));

        return back()->with('status', 'Permission change removed.');
    }

    public function setStatus(Request $request, int $id, AutoGroupSync $groups, MeshKeyring $keys): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.suspend');
        $data = $request->validate(['status' => 'required|in:active,suspended', 'reason' => 'required_if:status,suspended|nullable|string|max:300']);
        abort_if($member->id === $me->id, 422, 'You can\'t suspend yourself.');
        abort_if(Access::isSuper($member) && ! Access::isSuper($me), 403, 'Only a super admin can suspend a super admin.');

        $member->update(['status' => $data['status']]);
        if ($data['status'] === 'suspended') {
            $member->tokens()->delete();
            $member->devices()->update(['revoked_at' => now()]);
            $member->increment('token_version');
            $keys->rotate($member->institution_id); // a suspended phone can no longer read new mesh traffic
        }
        Access::forget($member->id);
        $groups->sync($member);
        AuditLog::record('member.'.$data['status'], $member, ['reason' => $data['reason'] ?? null]);

        return back()->with('status', "{$member->name} is now {$data['status']}.");
    }

    public function recordConsent(Request $request, int $id): RedirectResponse
    {
        $me = $request->user();
        $member = $this->member($me, $id, 'members.consent');
        $data = $request->validate(['source' => 'required|in:admission_records,guardian_form', 'reference' => 'nullable|string|max:120']);
        $member->forceFill(['guardian_consent_at' => now()])->save();
        \App\Models\Consent::create(['user_id' => $member->id, 'kind' => 'guardian', 'version' => config('sos.legal.policy_version'), 'granted' => true,
            'ip_address' => $request->ip(), 'user_agent' => 'recorded by '.$me->id.' from '.$data['source']]);
        Access::forget($member->id);
        AuditLog::record('member.guardian_consent', $member, $data);

        return back()->with('status', "Guardian consent recorded. {$member->name} can now use chat.");
    }

    // -----------------------------------------------------------------------------------------------

    private function member(User $me, int $id, string $permission): User
    {
        $member = User::inInstitution($me->institution_id)->where('member_type', '!=', 'relay')->findOrFail($id);
        abort_unless(Access::canOnUser($me, $permission, $member) || ($member->member_type === 'parent' && Access::canEverywhere($me, $permission)), 403,
            'This person is outside the areas you look after.');

        return $member;
    }

    /** Areas the admin can pick from (for filters and "where does this apply?"). */
    private function unitOptions(User $me, string ...$permissions): array
    {
        $ids = [];
        $all = false;
        foreach ($permissions as $p) {
            $u = Access::units($me, $p);
            if ($u === null) {
                $all = true;
            } else {
                $ids = array_merge($ids, $u);
            }
        }

        return OrgUnit::query()->when(! $all, fn ($q) => $q->whereIn('id', $ids ?: [0]))->orderBy('type')->orderBy('name')
            ->get(['id', 'name', 'code', 'type', 'parent_id'])
            ->map(fn ($u) => ['id' => $u->id, 'name' => $u->name, 'code' => $u->code, 'type' => $u->type, 'type_label' => OrgUnit::TYPES[$u->type] ?? 'Area', 'parent_id' => $u->parent_id])
            ->values()->all();
    }

    private function describeUnits(int $institutionId, array $units): string
    {
        if (! $units) {
            return 'Nowhere';
        }
        // Show only the top-most areas ("Faculty of Law" rather than each of its departments).
        $top = array_filter($units, fn ($u) => count(array_intersect(array_slice(Access::ancestors($institutionId, $u), 1), $units)) === 0);
        $names = OrgUnit::whereIn('id', $top)->pluck('name')->all();

        return implode(', ', array_slice($names, 0, 4)).(count($names) > 4 ? ' and '.(count($names) - 4).' more' : '');
    }
}
