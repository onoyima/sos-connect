<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\User;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Communities and groups, seen by staff who look after them (even when they aren't members): switch a group
 * off, rename it, choose who can post, make anyone a group admin with chosen powers, add or remove people.
 */
class GroupsAdminController extends Controller
{
    public function index(Request $request): Response
    {
        $me = $request->user();
        $units = Access::units($me, 'groups.view');
        $institution = $me->institution;

        $groups = Conversation::query()->whereIn('type', ['community', 'auto_group', 'group'])
            ->when($units !== null, fn ($q) => $q->whereIn('org_unit_id', $units ?: [0]))
            ->when($request->query('q'), fn ($q, $s) => $q->where('name', 'like', '%'.addcslashes(mb_substr((string) $s, 0, 80), '%_\\').'%'))
            ->orderByRaw("case type when 'community' then 0 when 'auto_group' then 1 else 2 end")->orderBy('name')
            ->limit(1500)->get();
        $counts = ConversationMember::whereIn('conversation_id', $groups->pluck('id'))->select('conversation_id', DB::raw('count(*) as n'))
            ->groupBy('conversation_id')->pluck('n', 'conversation_id');

        return Inertia::render('Admin/Groups', [
            'groups' => $groups->map(fn (Conversation $c) => [
                'id' => $c->id, 'name' => $c->name, 'type' => $c->type, 'auto_type' => $c->auto_type, 'parent_id' => $c->parent_id,
                'posting' => $c->posting, 'enabled' => $c->enabled, 'visible' => Modules::conversationVisible($institution, $c),
                'member_count' => (int) ($counts[$c->id] ?? 0),
            ])->values(),
            'filters' => $request->only('q'),
            'everywhere' => $units === null,
        ]);
    }

    public function show(Request $request, Conversation $conversation): Response
    {
        $me = $request->user();
        $this->authorizeArea($me, $conversation, 'groups.view');
        $search = trim((string) $request->query('q'));
        $members = ConversationMember::with('user:id,name,identifier,title,member_type')->where('conversation_id', $conversation->id)
            ->when($search, fn ($q) => $q->whereHas('user', fn ($u) => $u->where('name', 'like', '%'.addcslashes(mb_substr((string) $search, 0, 80), '%_\\').'%')->orWhere('identifier', $search)))
            ->orderByRaw("case when role = 'admin' then 0 else 1 end")->orderBy('id')->paginate(40)->withQueryString();

        return Inertia::render('Admin/GroupShow', [
            'group' => [
                'id' => $conversation->id, 'name' => $conversation->name, 'description' => $conversation->description, 'type' => $conversation->type,
                'auto_type' => $conversation->auto_type, 'posting' => $conversation->posting, 'enabled' => $conversation->enabled,
                'visible' => Modules::conversationVisible($me->institution, $conversation),
                'community' => $conversation->parent?->name, 'area' => $conversation->unit?->name,
                'children' => $conversation->children()->orderBy('name')->get(['id', 'name', 'type', 'enabled']),
            ],
            'members' => $members->through(fn ($m) => [
                'user_id' => $m->user_id, 'name' => $m->user?->name, 'identifier' => $m->user?->identifier, 'title' => $m->user?->title,
                'member_type' => $m->user?->member_type, 'role' => $m->role, 'powers' => $m->adminPermissionList(), 'managed' => $m->managed,
            ]),
            'powerLabels' => ConversationMember::ADMIN_PERMISSIONS,
            'filters' => $request->only('q'),
            'can' => [
                'manage' => $this->allowed($me, $conversation, 'groups.manage'),
                'members' => $this->allowed($me, $conversation, 'groups.members'),
                'admins' => $this->allowed($me, $conversation, 'groups.admins'),
            ],
        ]);
    }

    public function update(Request $request, Conversation $conversation): RedirectResponse
    {
        $me = $request->user();
        $this->authorizeArea($me, $conversation, 'groups.manage');
        $data = $request->validate(['name' => 'sometimes|string|max:120', 'description' => 'sometimes|nullable|string|max:500',
            'posting' => 'sometimes|in:everyone,admins', 'enabled' => 'sometimes|boolean']);
        if (isset($data['name']) && $conversation->auto_key && $data['name'] !== $conversation->name) {
            $data['name_locked'] = true;
        }
        $conversation->update($data);
        AuditLog::record('group.updated', $conversation, array_keys($data));

        return back()->with('status', isset($data['enabled'])
            ? ($data['enabled'] ? "{$conversation->name} is switched on." : "{$conversation->name} is switched off. Its messages are kept.")
            : 'Group saved.');
    }

    public function addMember(Request $request, Conversation $conversation): RedirectResponse
    {
        $me = $request->user();
        $this->authorizeArea($me, $conversation, 'groups.members');
        abort_if($conversation->type === 'community' || $conversation->type === 'direct', 422, 'People can only be added to groups.');
        $user = User::inInstitution($me->institution_id)->where('status', 'active')->findOrFail($request->validate(['user_id' => 'required|integer'])['user_id']);
        ConversationMember::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $user->id],
            ['role' => 'member', 'added_by' => $me->id, 'joined_at' => now()]);
        AuditLog::record('group.member_added', $conversation, ['user_id' => $user->id]);

        return back()->with('status', "Added {$user->name}.");
    }

    public function removeMember(Request $request, Conversation $conversation, int $userId): RedirectResponse
    {
        $me = $request->user();
        $this->authorizeArea($me, $conversation, 'groups.members');
        ConversationMember::where('conversation_id', $conversation->id)->where('user_id', $userId)->delete();
        AuditLog::record('group.member_removed', $conversation, ['user_id' => $userId]);

        return back()->with('status', 'Removed from the group. If they were added from records, they come back if their records change.');
    }

    public function setAdmin(Request $request, Conversation $conversation, int $userId): RedirectResponse
    {
        $me = $request->user();
        $this->authorizeArea($me, $conversation, 'groups.admins');
        $data = $request->validate(['role' => 'required|in:admin,member', 'powers' => 'nullable|array',
            'powers.*' => 'in:'.implode(',', array_keys(ConversationMember::ADMIN_PERMISSIONS))]);
        $user = User::inInstitution($me->institution_id)->findOrFail($userId);

        // Making someone admin of a group they're not in adds them to it.
        $membership = ConversationMember::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $user->id],
            ['role' => 'member', 'added_by' => $me->id, 'joined_at' => now()]);
        $powers = $data['role'] === 'admin' ? array_values(array_unique($data['powers'] ?? array_keys(ConversationMember::ADMIN_PERMISSIONS))) : null;
        $membership->update(['role' => $data['role'],
            'admin_permissions' => $powers === null || count($powers) === count(ConversationMember::ADMIN_PERMISSIONS) ? null : $powers]);
        AuditLog::record('group.admin_changed', $conversation, ['user_id' => $user->id, 'role' => $data['role'], 'powers' => $powers]);

        return back()->with('status', $data['role'] === 'admin' ? "{$user->name} is now an admin of {$conversation->name}." : "{$user->name} is no longer an admin.");
    }

    private function allowed(User $me, Conversation $c, string $permission): bool
    {
        return $c->org_unit_id ? Access::can($me, $permission, $c->org_unit_id) : Access::canEverywhere($me, $permission);
    }

    private function authorizeArea(User $me, Conversation $c, string $permission): void
    {
        abort_if($c->type === 'direct', 404);
        abort_unless($this->allowed($me, $c, $permission), 403, 'This group is outside the areas you look after.');
    }
}
