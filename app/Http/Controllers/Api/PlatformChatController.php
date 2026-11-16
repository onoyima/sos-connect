<?php

namespace App\Http\Controllers\Api;

use App\Events\UserSignal;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\PlatformChat\PlatformChat;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Support\Sealed;
use Illuminate\Support\Facades\DB;

/** The platform chat widget: platform owners ↔ each other ↔ school admins (see PlatformChat for the rules). */
class PlatformChatController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $me = $this->allowed($request);
        $threads = DB::table('platform_threads as t')
            ->join('platform_thread_members as m', fn ($j) => $j->on('m.thread_id', '=', 't.id')->where('m.user_id', $me->id))
            ->orderByRaw('COALESCE(t.last_message_at, t.created_at) DESC')->limit(100)
            ->get(['t.id', 't.title', 't.is_group', 't.last_message_at', 't.created_at', 'm.last_read_id']);
        $ids = $threads->pluck('id');

        $members = DB::table('platform_thread_members')->whereIn('thread_id', $ids)->get(['thread_id', 'user_id'])->groupBy('thread_id');
        $people = User::query()->with('institution:id,name')->whereIn('id', $members->flatten()->pluck('user_id')->unique())->get()->keyBy('id');
        $last = DB::table('platform_messages')->whereIn('id', DB::table('platform_messages')->whereIn('thread_id', $ids)
            ->groupBy('thread_id')->selectRaw('MAX(id)'))->get()->keyBy('thread_id');

        $unreadTotal = 0;
        $list = $threads->map(function ($t) use ($me, $members, $people, $last, &$unreadTotal) {
            $others = collect($members[$t->id] ?? [])->pluck('user_id')->reject(fn ($id) => (int) $id === (int) $me->id)
                ->map(fn ($id) => $people[$id] ?? null)->filter()->map(fn (User $u) => PlatformChat::person($u))->values();
            $unread = DB::table('platform_messages')->where('thread_id', $t->id)->where('id', '>', $t->last_read_id)
                ->where('user_id', '!=', $me->id)->count();
            $unreadTotal += $unread;
            $m = $last[$t->id] ?? null;

            return [
                'id' => $t->id,
                'is_group' => (bool) $t->is_group,
                'name' => $t->is_group ? ($t->title ?: $others->pluck('name')->take(3)->implode(', ')) : ($others[0]['name'] ?? 'Conversation'),
                'where' => $t->is_group ? $others->count().' people' : ($others[0]['where'] ?? ''),
                'people' => $others,
                'last' => $m ? ['body' => mb_substr((string) Sealed::open($m->body), 0, 120), 'mine' => (int) $m->user_id === (int) $me->id, 'at' => $m->created_at] : null,
                'unread' => $unread,
            ];
        });

        return response()->json(['threads' => $list, 'unread' => $unreadTotal, 'platform' => (bool) $me->is_platform_admin]);
    }

    public function people(Request $request): JsonResponse
    {
        $me = $this->allowed($request);

        return response()->json(['people' => PlatformChat::contacts($me, (string) $request->query('q', ''))->map(fn (User $u) => PlatformChat::person($u))]);
    }

    public function start(Request $request): JsonResponse
    {
        $me = $this->allowed($request);
        $data = $request->validate([
            'user_ids' => ['required', 'array', 'min:1', 'max:50'],
            'user_ids.*' => ['integer', 'distinct'],
            'title' => ['nullable', 'string', 'max:120'],
        ]);
        $others = User::query()->with('institution')->whereIn('id', $data['user_ids'])->get();
        if ($others->count() !== count($data['user_ids']) || $others->contains(fn (User $u) => ! PlatformChat::canStartWith($me, $u))) {
            abort(403, 'You can’t start a conversation with one of these people.');
        }
        $group = $others->count() > 1;
        if ($group && ! $me->is_platform_admin) {
            abort(403, 'Only the platform team can start group conversations here.');
        }
        if (! $group && ($existing = PlatformChat::directBetween($me->id, $others[0]->id))) {
            return response()->json(['id' => $existing]);
        }

        $id = DB::transaction(function () use ($me, $others, $group, $data) {
            $id = DB::table('platform_threads')->insertGetId(['title' => $group ? ($data['title'] ?? null) : null, 'is_group' => $group,
                'created_by' => $me->id, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('platform_thread_members')->insert($others->pluck('id')->push($me->id)->unique()
                ->map(fn ($uid) => ['thread_id' => $id, 'user_id' => $uid, 'last_read_id' => 0, 'created_at' => now(), 'updated_at' => now()])->all());

            return $id;
        });

        return response()->json(['id' => $id], 201);
    }

    public function messages(Request $request, int $thread): JsonResponse
    {
        $me = $this->allowed($request);
        $this->member($me, $thread);
        $after = (int) $request->query('after', 0);
        $rows = DB::table('platform_messages')->where('thread_id', $thread)->where('id', '>', $after)
            ->orderByDesc('id')->limit(200)->get(['id', 'user_id', 'body', 'created_at'])->reverse()->values();
        $names = User::query()->whereIn('id', $rows->pluck('user_id')->filter()->unique())->pluck('name', 'id');
        if ($rows->isNotEmpty()) {
            DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', $me->id)
                ->where('last_read_id', '<', $rows->last()->id)->update(['last_read_id' => $rows->last()->id, 'updated_at' => now()]);
        }

        return response()->json(['messages' => $rows->map(fn ($m) => [
            'id' => $m->id, 'body' => Sealed::open($m->body), 'at' => $m->created_at, 'mine' => (int) $m->user_id === (int) $me->id,
            'from' => $m->user_id ? ($names[$m->user_id] ?? 'Someone') : 'Removed account',
        ])]);
    }

    public function send(Request $request, int $thread): JsonResponse
    {
        $me = $this->allowed($request);
        $this->member($me, $thread);
        $data = $request->validate(['body' => ['required', 'string', 'max:4000']]);
        $body = trim($data['body']);
        abort_if($body === '', 422, 'Write a message first.');

        $id = DB::table('platform_messages')->insertGetId(['thread_id' => $thread, 'user_id' => $me->id, 'body' => Sealed::seal($body), // stored encrypted
            'created_at' => now(), 'updated_at' => now()]);
        DB::table('platform_threads')->where('id', $thread)->update(['last_message_at' => now(), 'updated_at' => now()]);
        DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', $me->id)->update(['last_read_id' => $id]);

        foreach (DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', '!=', $me->id)->pluck('user_id') as $uid) {
            UserSignal::dispatch((int) $uid, 'platform.message', ['thread_id' => $thread, 'from' => $me->name]);
        }

        return response()->json(['id' => $id, 'body' => $body, 'at' => now(), 'mine' => true, 'from' => $me->name], 201);
    }

    private function allowed(Request $request): User
    {
        $me = $request->user();
        abort_unless(PlatformChat::canUse($me), 403, 'The platform chat is for the platform team and school admins.');

        return $me;
    }

    private function member(User $me, int $thread): void
    {
        abort_unless(DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', $me->id)->exists(), 404);
    }
}
