<?php

namespace App\Services\Access;

use App\Models\AuditLog;
use App\Models\Institution;
use App\Models\OrgUnit;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Models\RolePermission;
use App\Models\User;
use App\Models\UserPermission;
use App\Support\Access;
use App\Support\CurrentInstitution;
use App\Support\PermissionCatalog;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Creates the starting roles for an institution and handles giving and removing roles and single permissions.
 *
 * The delegation rule: you can only give what you have, only where you have it. To give a role over an area
 * you need "roles.assign" over that area AND every permission in that role over that area. Only a super admin
 * can create another super admin, and the last super admin can't be removed.
 */
class RoleManager
{
    /** What every member gets by default; institutions can change this on the Student, Staff and Parent roles. */
    public const MEMBER_BASICS = ['chat.use', 'chat.direct', 'chat.files', 'directory.search', 'groups.create',
        'announcements.view', 'status.post', 'calls.voice', 'calls.video', 'sos.raise', 'face.capture'];

    private const NOTICES = ['announcements.create', 'announcements.edit', 'announcements.delete'];

    private const GROUP_ADMIN = ['groups.view', 'groups.manage', 'groups.members', 'groups.admins'];

    private const SAFETY = ['safety_checks.create', 'safety_checks.results'];

    /** The roles every institution starts with. They can be edited; only "Super admin" can't lose permissions. */
    public static function defaults(): array
    {
        $all = PermissionCatalog::keys();

        return [
            ['slug' => 'super_admin', 'name' => 'Super admin', 'rank' => 1, 'is_super' => true,
                'description' => 'Every permission, always. Can switch features on or off and manage every role.', 'permissions' => $all],
            ['slug' => 'institution_admin', 'name' => 'Institution admin', 'rank' => 3,
                'description' => 'Runs SOS Connect for the institution (usually ICT). Cannot read private messages.',
                'permissions' => array_merge(['chat.anyone', 'settings.edit', 'connector.edit', 'modules.manage', 'roles.view', 'roles.create', 'roles.edit',
                    'roles.delete', 'roles.assign', 'permissions.assign', 'members.view', 'members.contact', 'members.suspend', 'members.consent',
                    'parents.invite', 'units.view', 'units.manage', 'audit.view', 'reports.view', 'reports.resolve', 'data_requests.view',
                    'faces.view', 'faces.export', 'broadcasts.manage', 'help.manage', 'design.view', 'branding.manage'], self::GROUP_ADMIN)],
            ['slug' => 'vice_chancellor', 'name' => 'Vice-Chancellor', 'rank' => 5, 'dm_protected' => true,
                'description' => 'Institution-wide notices and safety checks, oversight of SOS and reports.',
                'permissions' => array_merge(self::NOTICES, self::SAFETY, ['chat.anyone', 'members.view', 'sos.view', 'reports.view', 'audit.view', 'groups.view', 'roles.view', 'units.view'])],
            ['slug' => 'registrar', 'name' => 'Registrar', 'rank' => 10, 'dm_protected' => true,
                'description' => 'Members, notices, safety checks and giving roles across the institution.',
                'permissions' => array_merge(self::NOTICES, self::SAFETY, self::GROUP_ADMIN, ['chat.anyone', 'members.view', 'members.contact', 'members.suspend',
                    'members.consent', 'parents.invite', 'sos.view', 'reports.view', 'reports.resolve', 'data_requests.view', 'roles.view',
                    'roles.assign', 'units.view', 'units.manage', 'broadcasts.manage'])],
            ['slug' => 'dean_student_affairs', 'name' => 'Dean of Student Affairs', 'rank' => 15,
                'description' => 'Student welfare: hostels, wardens, reports, safety and parents.',
                'permissions' => array_merge(self::NOTICES, self::SAFETY, self::GROUP_ADMIN, ['chat.anyone', 'members.view', 'members.contact', 'members.suspend',
                    'members.consent', 'parents.invite', 'sos.view', 'sos.respond', 'reports.view', 'reports.resolve', 'messages.delete',
                    'status.delete', 'roles.view', 'roles.assign'])],
            ['slug' => 'dean', 'name' => 'Dean', 'rank' => 20, 'dm_protected' => true,
                'description' => 'Give over a faculty: notices, members, groups and giving roles in that faculty.',
                'permissions' => array_merge(self::NOTICES, self::SAFETY, self::GROUP_ADMIN, ['chat.anyone', 'members.view', 'members.contact', 'sos.view',
                    'reports.view', 'roles.view', 'roles.assign', 'messages.delete'])],
            ['slug' => 'data_protection_officer', 'name' => 'Data protection officer', 'rank' => 25,
                'description' => 'Handles requests from people about their personal data.',
                'permissions' => ['data_requests.view', 'data_requests.handle', 'audit.view']],
            ['slug' => 'hod', 'name' => 'Head of department', 'rank' => 30,
                'description' => 'Give over a department: notices, members, groups and giving roles in that department only.',
                'permissions' => array_merge(self::NOTICES, self::SAFETY, self::GROUP_ADMIN, ['chat.anyone', 'members.view', 'members.contact', 'roles.view',
                    'roles.assign', 'messages.delete'])],
            ['slug' => 'unit_head', 'name' => 'Head of unit', 'rank' => 35,
                'description' => 'Give over an admin unit such as ICT, Bursary or Audit: notices and groups for that unit.',
                'permissions' => array_merge(['chat.anyone', 'announcements.create', 'members.view', 'members.contact', 'roles.view', 'roles.assign'], self::GROUP_ADMIN)],
            ['slug' => 'security', 'name' => 'Security and responders', 'rank' => 40,
                'description' => 'Receives every SOS in their area and responds to it.',
                'permissions' => array_merge(self::SAFETY, ['chat.anyone', 'sos.view', 'sos.respond', 'members.view', 'members.contact'])],
            ['slug' => 'health_centre', 'name' => 'Health centre', 'rank' => 45,
                'description' => 'Receives SOS alerts and sees safety check answers.',
                'permissions' => ['chat.anyone', 'sos.view', 'sos.respond', 'safety_checks.results', 'members.contact']],
            ['slug' => 'counsellor', 'name' => 'Counsellor', 'rank' => 46,
                'description' => 'Receives SOS alerts so they can follow up with students.',
                'permissions' => ['chat.anyone', 'sos.view', 'sos.respond', 'members.contact']],
            ['slug' => 'hall_warden', 'name' => 'Hall warden', 'rank' => 50,
                'description' => 'Give over a hostel: SOS, safety checks and notices for that hostel.',
                'permissions' => array_merge(self::SAFETY, ['sos.view', 'sos.respond', 'announcements.create'])],
            ['slug' => 'course_adviser', 'name' => 'Course adviser', 'rank' => 55,
                'description' => 'Give over a department: see and contact its students, post notices.',
                'permissions' => ['members.view', 'members.contact', 'announcements.create']],
            ['slug' => 'lecturer', 'name' => 'Lecturer', 'rank' => 60,
                'description' => 'Post notices to the department they teach in.',
                'permissions' => ['announcements.create', 'members.view']],
            ['slug' => 'moderator', 'name' => 'Moderator', 'rank' => 70,
                'description' => 'Deals with reported messages and status updates.',
                'permissions' => ['reports.view', 'reports.resolve', 'messages.delete', 'status.delete']],
            ['slug' => 'class_representative', 'name' => 'Class representative', 'rank' => 75,
                'description' => 'A student leader. Given over a department; becomes an admin of their level group who can always post there.',
                'permissions' => ['members.view']],
            ['slug' => 'staff', 'name' => 'Staff', 'rank' => 800, 'default_for' => 'staff',
                'description' => 'Every staff member has this automatically.', 'permissions' => self::MEMBER_BASICS],
            ['slug' => 'student', 'name' => 'Student', 'rank' => 900, 'default_for' => 'student',
                'description' => 'Every student has this automatically.', 'permissions' => self::MEMBER_BASICS],
            ['slug' => 'alumni', 'name' => 'Alumni', 'rank' => 920, 'default_for' => 'alumni',
                'description' => 'Every graduate has this automatically. They keep chats, notices and SOS, and join the alumni groups.',
                'permissions' => ['chat.use', 'chat.direct', 'chat.files', 'directory.search', 'announcements.view', 'calls.voice', 'calls.video', 'sos.raise']],
            ['slug' => 'parent', 'name' => 'Parent or guardian', 'rank' => 950, 'default_for' => 'parent',
                'description' => 'Every parent account has this automatically.', 'permissions' => ['chat.use', 'announcements.view', 'sos.raise']],
        ];
    }

    /** Creates any missing starting roles. Existing roles (and any edits made to them) are left alone. */
    public function installDefaults(Institution $institution): void
    {
        CurrentInstitution::as($institution->id, function () {
            foreach (self::defaults() as $def) {
                $role = Role::firstOrCreate(['slug' => $def['slug']], [
                    'name' => $def['name'], 'description' => $def['description'], 'rank' => $def['rank'],
                    'is_super' => $def['is_super'] ?? false, 'is_system' => true, 'default_for' => $def['default_for'] ?? null,
                    'dm_protected' => $def['dm_protected'] ?? false,
                ]);
                if ($role->wasRecentlyCreated) {
                    $this->writePermissions($role, $def['permissions']);
                }
            }
        });
    }

    // ---- Roles --------------------------------------------------------------------------------------

    public function saveRole(User $actor, ?Role $role, array $data): Role
    {
        $this->authorize(Access::can($actor, $role ? 'roles.edit' : 'roles.create'), 'You can\'t '.($role ? 'edit' : 'create').' roles.');
        $permissions = array_values(array_unique(array_filter($data['permissions'] ?? [], [PermissionCatalog::class, 'exists'])));

        if ($role?->is_super) {
            $permissions = PermissionCatalog::keys(); // super admin always has everything
        }
        // You can't put permissions into a role that you don't have yourself.
        if (! Access::isSuper($actor)) {
            $missing = array_filter($permissions, fn ($p) => ! Access::canEverywhere($actor, $p) && ! in_array($p, $role?->permissionKeys() ?? [], true));
            $this->authorize($missing === [], 'You can only add permissions you hold everywhere: '.implode(', ', $missing));
        }

        return DB::transaction(function () use ($actor, $role, $data, $permissions) {
            $before = $role?->permissionKeys() ?? [];
            if (! $role) {
                $role = Role::create(['name' => $data['name'], 'slug' => $this->uniqueSlug($data['name']), 'description' => $data['description'] ?? null,
                    'rank' => (int) ($data['rank'] ?? 100), 'dm_protected' => (bool) ($data['dm_protected'] ?? false)]);
            } else {
                $role->update(['name' => $data['name'], 'description' => $data['description'] ?? null,
                    'dm_protected' => (bool) ($data['dm_protected'] ?? $role->dm_protected)]);
            }
            $this->writePermissions($role, $permissions);
            Access::forget();

            AuditLog::record($role->wasRecentlyCreated ? 'role.created' : 'role.updated', $role, [
                'by' => $actor->id, 'added' => array_values(array_diff($permissions, $before)), 'removed' => array_values(array_diff($before, $permissions)),
            ]);

            return $role->load('permissions');
        });
    }

    public function deleteRole(User $actor, Role $role): void
    {
        $this->authorize(Access::can($actor, 'roles.delete'), 'You can\'t delete roles.');
        $this->fail($role->is_system, 'Built-in roles can be edited but not deleted.');
        $this->fail($role->assignments()->exists(), 'Remove this role from everyone who has it first.');
        $role->delete();
        Access::forget();
        AuditLog::record('role.deleted', $role, ['by' => $actor->id, 'name' => $role->name]);
    }

    // ---- Giving roles -------------------------------------------------------------------------------

    public function assign(User $actor, User $user, Role $role, ?int $unitId, ?CarbonInterface $expiresAt = null, ?string $note = null): RoleAssignment
    {
        // Always work inside the person's own institution, whoever calls this (website, console, queue or test).
        return CurrentInstitution::as($user->institution_id, fn () => $this->assignWithin($actor, $user, $role, $unitId, $expiresAt, $note));
    }

    protected function assignWithin(User $actor, User $user, Role $role, ?int $unitId, ?CarbonInterface $expiresAt, ?string $note): RoleAssignment
    {
        $this->sameInstitution($actor, $user);
        $this->fail($role->default_for !== null, 'Everyone of that kind already has this role automatically.');
        $this->fail($role->is_super && $unitId !== null, 'Super admin is always for the whole institution.');
        $this->authorize($this->canGiveRole($actor, $role, $unitId), $this->deniedReason($actor, $role, $unitId));

        $existing = RoleAssignment::where('user_id', $user->id)->where('role_id', $role->id)
            ->where(fn ($q) => $unitId === null ? $q->whereNull('org_unit_id') : $q->where('org_unit_id', $unitId))->first();

        $assignment = $existing ?? new RoleAssignment(['user_id' => $user->id, 'role_id' => $role->id, 'org_unit_id' => $unitId]);
        $assignment->fill(['expires_at' => $expiresAt, 'note' => $note, 'source' => 'manual', 'granted_by' => $actor->id])->save();

        $this->afterChange($user);
        AuditLog::record('role.assigned', $user, ['role' => $role->name, 'area' => $this->unitName($unitId), 'until' => $expiresAt?->toDateString(), 'by' => $actor->id, 'note' => $note]);

        return $assignment;
    }

    public function unassign(User $actor, RoleAssignment $assignment): void
    {
        $role = $assignment->role;
        $user = $assignment->user;
        $this->sameInstitution($actor, $user);
        $this->authorize($this->canGiveRole($actor, $role, $assignment->org_unit_id), 'You can only remove roles you are allowed to give, in your own area.');
        if ($role->is_super) {
            $others = RoleAssignment::where('role_id', $role->id)->where('id', '!=', $assignment->id)->active()
                ->whereHas('user', fn ($q) => $q->where('status', 'active'))->count();
            $this->fail($others === 0, 'You can\'t remove the last super admin. Make someone else super admin first.');
        }
        $assignment->delete();
        $this->afterChange($user);
        AuditLog::record('role.removed', $user, ['role' => $role->name, 'area' => $this->unitName($assignment->org_unit_id), 'by' => $actor->id]);
    }

    public function canGiveRole(User $actor, Role $role, ?int $unitId): bool
    {
        if (Access::isSuper($actor)) {
            return true;
        }
        if ($role->is_super) {
            return false;
        }
        $hasAssign = $unitId === null ? Access::canEverywhere($actor, 'roles.assign') : Access::can($actor, 'roles.assign', $unitId);
        if (! $hasAssign) {
            return false;
        }
        foreach ($role->permissionKeys() as $p) {
            $ok = ($unitId === null || ! PermissionCatalog::isArea($p)) ? Access::canEverywhere($actor, $p) : Access::can($actor, $p, $unitId);
            if (! $ok) {
                return false;
            }
        }

        return true;
    }

    // ---- Single permissions -------------------------------------------------------------------------

    public function grantPermission(User $actor, User $user, string $permission, string $effect, ?int $unitId, ?CarbonInterface $expiresAt = null, ?string $note = null): UserPermission
    {
        $this->sameInstitution($actor, $user);
        $this->fail(! PermissionCatalog::exists($permission), 'Unknown permission.');
        $this->fail($unitId !== null && ! PermissionCatalog::isArea($permission), 'This permission can only be given for the whole institution.');
        $this->authorize($this->canGivePermission($actor, $permission, $unitId), 'You can only give or take away permissions you hold yourself, in your own area.');

        $row = UserPermission::updateOrCreate(
            ['user_id' => $user->id, 'permission' => $permission, 'org_unit_id' => $unitId, 'effect' => $effect],
            ['expires_at' => $expiresAt, 'granted_by' => $actor->id, 'note' => $note],
        );
        // A grant and a deny for the same thing in the same place would cancel out; keep only the newest.
        UserPermission::where('user_id', $user->id)->where('permission', $permission)->where('org_unit_id', $unitId)
            ->where('effect', '!=', $effect)->delete();

        $this->afterChange($user);
        AuditLog::record('permission.'.($effect === 'deny' ? 'denied' : 'granted'), $user, ['permission' => $permission, 'area' => $this->unitName($unitId), 'by' => $actor->id, 'note' => $note]);

        return $row;
    }

    public function removePermission(User $actor, UserPermission $row): void
    {
        $user = User::findOrFail($row->user_id);
        $this->sameInstitution($actor, $user);
        $this->authorize($this->canGivePermission($actor, $row->permission, $row->org_unit_id), 'You can only change permissions you hold yourself, in your own area.');
        $row->delete();
        $this->afterChange($user);
        AuditLog::record('permission.removed', $user, ['permission' => $row->permission, 'effect' => $row->effect, 'by' => $actor->id]);
    }

    public function canGivePermission(User $actor, string $permission, ?int $unitId): bool
    {
        if (Access::isSuper($actor)) {
            return true;
        }
        $assign = $unitId === null ? Access::canEverywhere($actor, 'permissions.assign') : Access::can($actor, 'permissions.assign', $unitId);
        $holds = $unitId === null ? Access::canEverywhere($actor, $permission) : Access::can($actor, $permission, $unitId);

        return $assign && $holds;
    }

    /** Students can't start private chats with holders of protected roles (e.g. the VC); they use official groups. */
    public static function isProtectedFromStudents(User $user): bool
    {
        return CurrentInstitution::as($user->institution_id, fn () => RoleAssignment::where('user_id', $user->id)->active()
            ->whereHas('role', fn ($q) => $q->where('dm_protected', true))->exists());
    }

    /** Keeps the display label ("Head of department, Physics") in step with someone's roles. */
    public function refreshTitle(User $user): void
    {
        $title = CurrentInstitution::as($user->institution_id, function () use ($user) {
            $a = RoleAssignment::with(['role', 'unit'])->where('user_id', $user->id)->active()->get()
                ->sortBy(fn ($a) => $a->role?->rank ?? 999)->first();

            return $a?->role ? $a->role->name.($a->unit ? ', '.($a->unit->name) : '') : null;
        });
        if ($user->title !== $title) {
            $user->forceFill(['title' => $title ? mb_substr($title, 0, 160) : null])->saveQuietly();
        }
    }

    // -------------------------------------------------------------------------------------------------

    private function afterChange(User $user): void
    {
        Access::forget($user->id);
        $this->refreshTitle($user);
        $user->increment('token_version'); // phones refresh their certificate (and role label) on next sync
        app(\App\Services\Groups\AutoGroupSync::class)->sync($user); // e.g. a new class rep becomes admin of their level group
    }

    private function writePermissions(Role $role, array $permissions): void
    {
        RolePermission::where('role_id', $role->id)->whereNotIn('permission', $permissions)->delete();
        $have = RolePermission::where('role_id', $role->id)->pluck('permission')->all();
        foreach (array_diff($permissions, $have) as $p) {
            RolePermission::create(['role_id' => $role->id, 'permission' => $p]);
        }
        $role->unsetRelation('permissions');
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name, '_') ?: 'role';
        $slug = $base;
        for ($i = 2; Role::where('slug', $slug)->exists(); $i++) {
            $slug = "{$base}_{$i}";
        }

        return $slug;
    }

    private function deniedReason(User $actor, Role $role, ?int $unitId): string
    {
        if ($role->is_super) {
            return 'Only a super admin can make someone a super admin.';
        }
        $hasAssign = $unitId === null ? Access::canEverywhere($actor, 'roles.assign') : Access::can($actor, 'roles.assign', $unitId);

        return $hasAssign
            ? "You can only give a role whose permissions you hold yourself in that area. {$role->name} includes some you don't."
            : 'You can\'t give roles '.($unitId ? 'in that area' : 'for the whole institution').'.';
    }

    private function unitName(?int $unitId): string
    {
        return $unitId ? (OrgUnit::find($unitId)?->name ?? "area #{$unitId}") : 'whole institution';
    }

    private function sameInstitution(User $actor, User $user): void
    {
        abort_unless($actor->institution_id && $actor->institution_id === $user->institution_id, 404);
    }

    private function authorize(bool $ok, string $message): void
    {
        abort_unless($ok, 403, $message);
    }

    private function fail(bool $condition, string $message): void
    {
        if ($condition) {
            throw ValidationException::withMessages(['role' => $message]);
        }
    }
}
