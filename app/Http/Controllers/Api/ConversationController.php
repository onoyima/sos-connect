<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Message;
use App\Models\User;
use App\Services\Access\RoleManager;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ConversationController extends Controller
{
    /**
     * Chats and groups I'm in (last message, unread count, member count — never the member list), plus the
     * communities they sit in. Groups whose feature is switched off are left out, not deleted.
     */
    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        $institution = $me->institution;
        $memberships = ConversationMember::where('user_id', $me->id)->get()->keyBy('conversation_id');

        $all = Conversation::whereIn('id', $memberships->keys())->get()
            ->filter(fn (Conversation $c) => Modules::conversationVisible($institution, $c));
        $communities = $all->where('type', 'community');
        $chats = $all->where('type', '!=', 'community')->sortByDesc(fn ($c) => $c->last_message_at?->getTimestamp() ?? 0);
        $ids = $chats->pluck('id')->all();

        $counts = ConversationMember::whereIn('conversation_id', $all->pluck('id'))->select('conversation_id', DB::raw('count(*) as n'))
            ->groupBy('conversation_id')->pluck('n', 'conversation_id');
        $lastIds = Message::whereIn('conversation_id', $ids)->select(DB::raw('max(id) as id'))->groupBy('conversation_id')->pluck('id');
        $last = Message::with('sender:id,name')->whereIn('id', $lastIds)->get()->keyBy('conversation_id');

        $directPeers = ConversationMember::whereIn('conversation_id', $chats->where('type', 'direct')->pluck('id'))
            ->where('user_id', '!=', $me->id)->with('user:id,name,title,last_seen_at')->get()->keyBy('conversation_id');

        // A paused chat shows nothing newer than when it was paused (those messages appear when I resume).
        foreach ($ids as $cid) {
            if (($held = $memberships[$cid]->paused_after_message_id) !== null) {
                $last[$cid] = Message::with('sender:id,name')->where('conversation_id', $cid)->where('id', '<=', $held)->orderByDesc('id')->first();
            }
        }

        $unread = [];
        foreach ($ids as $cid) {
            $held = $memberships[$cid]->paused_after_message_id;
            $unread[$cid] = Message::where('conversation_id', $cid)->where('sender_id', '!=', $me->id)
                ->where('id', '>', (int) $memberships[$cid]->last_read_message_id)
                ->when($held !== null, fn ($q) => $q->where('id', '<=', $held))->limit(100)->count();
        }

        return response()->json([
            'conversations' => $chats->map(fn (Conversation $c) => [
                'id' => $c->id,
                'type' => $c->type,
                'auto_type' => $c->auto_type,
                'community_id' => $c->parent_id,
                'name' => $c->type === 'direct' ? (($directPeers[$c->id] ?? null)?->user?->name ?? 'Former member') : $c->name,
                'peer' => $c->type === 'direct' ? ($directPeers[$c->id] ?? null)?->user?->only(['id', 'name', 'last_seen_at']) : null,
                'posting' => $c->posting,
                'can_post' => $c->posting === 'everyone' || $c->canPost($me),
                'my_role' => $memberships[$c->id]->role,
                'muted' => $memberships[$c->id]->isMuted(),
                'muted_until' => $memberships[$c->id]->isMuted() ? $memberships[$c->id]->muted_until?->toIso8601String() : null,
                'archived' => (bool) $memberships[$c->id]->archived_at,
                'paused_after' => $memberships[$c->id]->paused_after_message_id,
                'member_count' => (int) ($counts[$c->id] ?? 0),
                'unread' => $unread[$c->id] ?? 0,
                'last_message' => ($last[$c->id] ?? null)?->toClient(),
                'last_message_at' => $c->last_message_at?->toIso8601String(),
            ])->values(),
            'communities' => $communities->map(fn (Conversation $c) => [
                'id' => $c->id, 'name' => $c->name, 'description' => $c->description, 'parent_id' => $c->parent_id,
                'member_count' => (int) ($counts[$c->id] ?? 0),
            ])->sortBy('name')->values(),
        ]);
    }

    /** One group: what it is, and what I'm allowed to do in it (for the info panel). */
    public function show(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $request->user();
        $membership = $this->assertMember($conversation, $me);

        return response()->json(['conversation' => [
            'id' => $conversation->id, 'type' => $conversation->type, 'auto_type' => $conversation->auto_type, 'name' => $conversation->name,
            'description' => $conversation->description, 'posting' => $conversation->posting, 'community_id' => $conversation->parent_id,
            'community' => $conversation->parent?->name,
            'member_count' => ConversationMember::where('conversation_id', $conversation->id)->count(),
            'my_role' => $membership->role,
            'my_admin_permissions' => $membership->adminPermissionList(),
            'can' => [
                'post' => $conversation->canPost($me),
                'members' => $conversation->manageableBy($me, 'members'),
                'settings' => $conversation->manageableBy($me, 'settings'),
                'admins' => $conversation->manageableBy($me, 'admins'),
                'delete_messages' => $conversation->manageableBy($me, 'delete_messages'),
                'leave' => ! $membership->managed && $conversation->type !== 'direct',
            ],
            'admin_permission_labels' => ConversationMember::ADMIN_PERMISSIONS,
        ]]);
    }

    /**
     * Newest messages first page; scroll up with ?before=<oldest id you have>.
     * ?around=<id> returns the messages either side of one (to jump to a search result or a quoted message).
     */
    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $held = $this->assertMember($conversation, $request->user())->paused_after_message_id;
        $limit = min((int) $request->query('limit', 50), 100);
        $before = (int) $request->query('before', 0);
        $around = (int) $request->query('around', 0);
        $base = fn () => Message::withTrashed()->with(['sender:id,name', 'replyTo'])->where('conversation_id', $conversation->id)
            ->when($held !== null, fn ($q) => $q->where('id', '<=', $held)); // paused: newer messages wait until I resume

        if ($around) {
            $older = $base()->where('id', '<=', $around)->orderByDesc('id')->limit(25)->get()->reverse();
            $newer = $base()->where('id', '>', $around)->orderBy('id')->limit(25)->get();
            $messages = $older->concat($newer)->values();

            return response()->json(['messages' => $messages->map->toClient(), 'has_more' => $older->count() === 25, 'has_newer' => $newer->count() === 25]);
        }

        $messages = $base()->when($before, fn ($q) => $q->where('id', '<', $before))
            ->orderByDesc('id')->limit($limit)->get()->reverse()->values();

        return response()->json(['messages' => $messages->map->toClient(), 'has_more' => $messages->count() === $limit]);
    }

    /**
     * Search one conversation. Message text is encrypted in the database, so it's matched here after decrypting,
     * newest first, looking back through the last 5,000 messages. Returns up to 50 matches.
     */
    public function search(Request $request, Conversation $conversation): JsonResponse
    {
        $this->assertMember($conversation, $request->user());
        $q = mb_strtolower(trim((string) $request->validate(['q' => 'required|string|min:2|max:100'])['q']));
        $found = collect();
        $scanned = 0;
        Message::with('sender:id,name')->where('conversation_id', $conversation->id)->whereIn('type', ['text', 'file', 'image'])
            ->orderByDesc('id')->chunk(500, function ($chunk) use ($q, &$found, &$scanned) {
                foreach ($chunk as $m) {
                    if (str_contains(mb_strtolower((string) $m->body), $q)) {
                        $found->push($m);
                    }
                }
                $scanned += $chunk->count();

                return $found->count() < 50 && $scanned < 5000;
            });

        return response()->json(['results' => $found->take(50)->map->toClient()->values(), 'searched_all' => $scanned < 5000]);
    }

    public function members(Request $request, Conversation $conversation): JsonResponse
    {
        $this->assertMember($conversation, $request->user());
        $q = trim((string) $request->query('q', ''));
        $page = ConversationMember::where('conversation_id', $conversation->id)->with('user.department')
            ->when(mb_strlen($q) >= 1, fn ($w) => $w->whereHas('user', fn ($u) => $u->where('name', 'like', '%'.addcslashes($q, '%_').'%')))
            ->orderByRaw("case when role = 'admin' then 0 else 1 end")->orderBy('id')->paginate(50);

        return response()->json([
            'members' => collect($page->items())->filter(fn ($m) => $m->user)->map(fn ($m) => [
                'role' => $m->role, 'admin_permissions' => $m->adminPermissionList(), 'managed' => $m->managed,
            ] + $m->user->publicProfile($request->user()))->values(),
            'next_page' => $page->hasMorePages() ? $page->currentPage() + 1 : null,
            'total' => $page->total(),
        ]);
    }

    public function direct(Request $request): JsonResponse
    {
        $me = $request->user();
        $peer = $me->colleagues()->findOrFail($request->validate(['user_id' => 'required|integer'])['user_id']);
        // Straight away, or "send a chat request first" (needs_request: true), by the rules in ContactPolicy.
        $conversation = \App\Services\Chat\DirectChats::open($me, $peer);

        return response()->json(['conversation_id' => $conversation->id], 201);
    }

    public function group(Request $request): JsonResponse
    {
        $me = $request->user();
        abort_unless(Access::can($me, 'groups.create'), 403, 'Creating groups is turned off for you.');
        if ($me->member_type === 'student') {
            abort_unless($me->institution->setting('student_group_creation'), 403, 'Your institution has turned off student-created groups.');
        }
        $data = $request->validate(['name' => 'required|string|max:80', 'description' => 'nullable|string|max:500',
            'member_ids' => 'array|max:256', 'member_ids.*' => 'integer']);

        // Only people you could chat with straight away can be added; others need to accept a chat request first.
        $members = $me->colleagues()->whereIn('id', $data['member_ids'] ?? [])->get()
            ->filter(fn ($m) => \App\Services\Chat\ContactPolicy::mode($me, $m) === \App\Services\Chat\ContactPolicy::DIRECT);
        $conversation = DB::transaction(function () use ($me, $data, $members) {
            $c = Conversation::create(['type' => 'group', 'name' => $data['name'], 'description' => $data['description'] ?? null, 'created_by' => $me->id]);
            ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $me->id, 'role' => 'admin', 'joined_at' => now()]);
            foreach ($members as $m) {
                ConversationMember::firstOrCreate(['conversation_id' => $c->id, 'user_id' => $m->id],
                    ['role' => 'member', 'added_by' => $me->id, 'joined_at' => now()]);
            }

            return $c;
        });

        return response()->json(['conversation_id' => $conversation->id, 'skipped' => array_values(array_diff($data['member_ids'] ?? [], $members->pluck('id')->all()))], 201);
    }

    public function addMember(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $request->user();
        abort_if($conversation->type === 'direct' || $conversation->isCommunity(), 422, 'People can only be added to groups.');
        abort_unless($conversation->manageableBy($me, 'members'), 403, 'Only group admins allowed to manage members can add people.');
        $user = $me->colleagues()->findOrFail($request->validate(['user_id' => 'required|integer'])['user_id']);
        // Group admins add people they could chat with; staff who manage groups for the institution can add anyone.
        $official = $conversation->org_unit_id ? Access::can($me, 'groups.members', $conversation->org_unit_id) : Access::canEverywhere($me, 'groups.members');
        abort_if(! $official && \App\Services\Chat\ContactPolicy::mode($me, $user) !== \App\Services\Chat\ContactPolicy::DIRECT, 403,
            "{$user->name} needs to accept a chat request from you before you can add them to a group.");
        ConversationMember::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $user->id],
            ['role' => 'member', 'added_by' => $me->id, 'joined_at' => now()]);
        AuditLog::record('conversation.member_added', $conversation, ['user_id' => $user->id]);

        return response()->json(['ok' => true]);
    }

    public function removeMember(Request $request, Conversation $conversation, int $userId): JsonResponse
    {
        $me = $request->user();
        $membership = ConversationMember::where('conversation_id', $conversation->id)->where('user_id', $userId)->firstOrFail();

        if ($userId === $me->id) {
            abort_if($membership->managed, 422, 'This group follows your records at the institution. You can mute it, but not leave it.');
        } else {
            abort_unless($conversation->manageableBy($me, 'members'), 403, 'Only group admins allowed to manage members can remove people.');
            // People placed here by the institution's records can only be taken out by staff with that power over the area.
            $areaPower = $conversation->org_unit_id ? Access::can($me, 'groups.members', $conversation->org_unit_id) : Access::canEverywhere($me, 'groups.members');
            abort_if($membership->managed && ! $areaPower, 403, 'This person was added from the institution\'s records. Ask an admin with group powers for this area.');
        }
        $membership->delete();
        AuditLog::record('conversation.member_removed', $conversation, ['user_id' => $userId]);

        return response()->json(['ok' => true]);
    }

    /** Make someone a group admin with chosen powers, or back to a normal member. */
    public function setRole(Request $request, Conversation $conversation, int $userId): JsonResponse
    {
        $me = $request->user();
        abort_unless($conversation->manageableBy($me, 'admins'), 403, 'You can\'t change admins in this group.');
        $data = $request->validate(['role' => 'required|in:admin,member', 'admin_permissions' => 'nullable|array',
            'admin_permissions.*' => 'in:'.implode(',', array_keys(ConversationMember::ADMIN_PERMISSIONS))]);
        $membership = ConversationMember::where('conversation_id', $conversation->id)->where('user_id', $userId)->firstOrFail();

        $powers = $data['role'] === 'admin' ? array_values(array_unique($data['admin_permissions'] ?? array_keys(ConversationMember::ADMIN_PERMISSIONS))) : null;
        // A group admin can only pass on powers they have themselves; staff with area powers can give any.
        $areaPower = $conversation->org_unit_id ? Access::can($me, 'groups.admins', $conversation->org_unit_id) : Access::canEverywhere($me, 'groups.admins');
        if (! $areaPower && $powers) {
            $mine = $conversation->membershipFor($me)?->adminPermissionList() ?? [];
            abort_if(array_diff($powers, $mine) !== [], 403, 'You can only give group powers you have yourself.');
        }

        $membership->update(['role' => $data['role'], 'admin_permissions' => $powers === null || count($powers) === count(ConversationMember::ADMIN_PERMISSIONS) ? null : $powers]);
        AuditLog::record('conversation.admin_changed', $conversation, ['user_id' => $userId, 'role' => $data['role'], 'powers' => $powers]);

        return response()->json(['ok' => true]);
    }

    public function settings(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['muted' => 'sometimes|boolean', 'mute_hours' => 'sometimes|nullable|integer|in:8,168',
            'archived' => 'sometimes|boolean', 'paused' => 'sometimes|boolean', 'posting' => 'sometimes|in:everyone,admins',
            'name' => 'sometimes|string|max:120', 'description' => 'sometimes|nullable|string|max:500']);
        $inst = $me->institution;
        if (array_key_exists('muted', $data)) {
            abort_unless(Modules::enabled($inst, 'mute_chats') || ! $data['muted'], 403, 'Muting chats is switched off by your institution.');
            $this->assertMember($conversation, $me)->update(['muted' => $data['muted'],
                'muted_until' => $data['muted'] && ! empty($data['mute_hours']) ? now()->addHours((int) $data['mute_hours']) : null]);
        }
        if (array_key_exists('archived', $data)) {
            abort_unless(Modules::enabled($inst, 'archive_chats') || ! $data['archived'], 403, 'Archiving chats is switched off by your institution.');
            $this->assertMember($conversation, $me)->update(['archived_at' => $data['archived'] ? now() : null]);
        }
        if (array_key_exists('paused', $data)) {
            abort_unless(Modules::enabled($inst, 'pause_chats') || ! $data['paused'], 403, 'Pausing chats is switched off by your institution.');
            $membership = $this->assertMember($conversation, $me);
            $membership->update(['paused_after_message_id' => $data['paused']
                ? (int) (Message::withTrashed()->where('conversation_id', $conversation->id)->max('id') ?? 0)
                : null]);
        }
        $changes = array_intersect_key($data, array_flip(['posting', 'name', 'description']));
        if ($changes) {
            abort_unless($conversation->manageableBy($me, 'settings'), 403, 'Only group admins allowed to change settings can do this.');
            if (isset($changes['name']) && $conversation->auto_key) {
                $changes['name_locked'] = true; // keep the admin's name even if the records rename the unit
            }
            $conversation->update($changes);
            AuditLog::record('conversation.settings_changed', $conversation, array_keys($changes));
        }

        return response()->json(['ok' => true]);
    }

    public function read(Request $request, Conversation $conversation): JsonResponse
    {
        $membership = $this->assertMember($conversation, $request->user());
        $last = (int) $request->validate(['last_read_message_id' => 'required|integer'])['last_read_message_id'];
        if ($last > (int) $membership->last_read_message_id) {
            $membership->update(['last_read_message_id' => $last]);
        }

        return response()->json(['ok' => true]);
    }

    private function assertMember(Conversation $conversation, User $user): ConversationMember
    {
        $m = $conversation->membershipFor($user);
        abort_unless($m, 403, 'You are not a member of this conversation.');
        abort_unless(Modules::conversationVisible($user->institution, $conversation), 403, 'This group is switched off.');

        return $m;
    }
}
