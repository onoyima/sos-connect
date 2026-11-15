<?php

namespace App\Http\Controllers\Api;

use App\Events\UserSignal;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\GroupCall;
use App\Models\GroupCallParticipant;
use App\Models\Message;
use App\Services\Chat\MessageService;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Voice and video calls in a group chat. Everyone in the call connects to everyone else (a "mesh"), so calls stay
 * small (config sos.calls.group_max). The server only keeps the list of who's in and relays the setup messages;
 * the audio and video go between the phones and browsers, through the TURN relay when a network blocks that.
 *
 * Joining: the newcomer gets the list of who's already there and sends each of them an offer; those already in
 * the call just answer. Everyone checks in every 15 seconds; whoever stops is treated as gone.
 */
class GroupCallController extends Controller
{
    /** Start a call in a group, or join the one already running there. */
    public function start(Request $request, Conversation $conversation, MessageService $messages): JsonResponse
    {
        $me = $request->user();
        $type = $request->validate(['type' => 'required|in:voice,video'])['type'];
        $this->mayCall($me, $conversation, $type);
        abort_unless($conversation->canPost($me), 403, 'Only group admins can start a call in this group.');

        $running = $this->running($conversation);
        if ($running) {
            return $this->join($request, $running->call_uuid);
        }

        $recent = GroupCall::where('started_by', $me->id)->where('started_at', '>', now()->subMinutes(2))->count();
        abort_if($recent >= 3, 429, 'Too many calls started. Wait a minute.');

        $call = DB::transaction(function () use ($me, $conversation, $type) {
            $call = GroupCall::create(['institution_id' => $conversation->institution_id, 'call_uuid' => (string) Str::uuid(),
                'conversation_id' => $conversation->id, 'started_by' => $me->id, 'type' => $type, 'started_at' => now()]);
            GroupCallParticipant::create(['group_call_id' => $call->id, 'user_id' => $me->id, 'joined_at' => now(), 'seen_at' => now()]);

            return $call;
        });

        // A card in the chat so everyone sees there's a call and can join it, even those who weren't rung.
        // The call's own id doubles as the card's message id (unique, and fits the 36-character column).
        $messages->system($me, $conversation, $call->call_uuid, ($type === 'video' ? 'Video' : 'Voice').' call started',
            ['call' => ['uuid' => $call->call_uuid, 'type' => $type]]);

        $members = ConversationMember::where('conversation_id', $conversation->id)->where('user_id', '!=', $me->id);
        if ((clone $members)->count() <= config('sos.calls.group_ring_limit')) {
            $ids = $members->where('muted', false)->pluck('user_id')->all();
            $payload = $this->ringPayload($call, $conversation, $me);
            foreach ($ids as $id) {
                UserSignal::dispatch($id, 'groupcall.ring', $payload);
            }
            SendPush::dispatchAfterResponse($ids, ($conversation->name ?? 'Group').': '.$type.' call', "{$me->name} started a call. Tap to join.",
                ['type' => 'group_call', 'call_uuid' => $call->call_uuid, 'conversation_id' => $conversation->id], true);
        }

        return response()->json($this->state($call, $me->id) + ['joined' => true], 201);
    }

    /** The call running in a group right now, if any (for the "Join call" bar). */
    public function current(Request $request, Conversation $conversation): JsonResponse
    {
        abort_unless($conversation->membershipFor($request->user()), 403);
        $call = $this->running($conversation);

        return response()->json(['call' => $call ? $this->state($call, $request->user()->id) : null]);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $call = $this->call($request, $uuid);

        return response()->json($this->state($call, $request->user()->id));
    }

    public function join(Request $request, string $uuid): JsonResponse
    {
        $me = $request->user();
        $call = $this->call($request, $uuid);
        if ($call->ended_at === null && ! $call->present()->exists()) {
            $this->end($call); // everyone dropped without hanging up
        }
        abort_if($call->ended_at !== null, 410, 'This call has ended.');
        $this->mayCall($me, $call->conversation, $call->type);

        $already = $call->present()->where('user_id', '!=', $me->id)->with('user:id,name')->get();
        abort_if($already->count() >= config('sos.calls.group_max'), 409, 'This call is full ('.config('sos.calls.group_max').' people).');

        GroupCallParticipant::updateOrCreate(['group_call_id' => $call->id, 'user_id' => $me->id],
            ['joined_at' => now(), 'seen_at' => now(), 'left_at' => null]);
        foreach ($already as $p) {
            UserSignal::dispatch($p->user_id, 'groupcall.joined', ['call_uuid' => $call->call_uuid, 'user' => ['id' => $me->id, 'name' => $me->name]]);
        }

        return response()->json($this->state($call, $me->id) + ['joined' => true]);
    }

    /** Relays one setup message (offer, answer or network candidate) to one other person in the call. */
    public function signal(Request $request, string $uuid): JsonResponse
    {
        $me = $request->user();
        $call = $this->call($request, $uuid);
        $data = $request->validate(['to' => 'required|integer', 'data' => 'required|array']);
        abort_if(strlen(json_encode($data['data'])) > 16_000, 413);
        abort_unless($call->present()->whereIn('user_id', [$me->id, $data['to']])->count() === 2, 409, 'That person is no longer in the call.');

        UserSignal::dispatch((int) $data['to'], 'groupcall.signal', ['call_uuid' => $uuid, 'from' => $me->id, 'data' => $data['data']]);

        return response()->json(['ok' => true]);
    }

    /** "Still here". Returns who is in the call now, so everyone's list stays right even if a leave was missed. */
    public function ping(Request $request, string $uuid): JsonResponse
    {
        $me = $request->user();
        $call = $this->call($request, $uuid);
        $updated = GroupCallParticipant::where('group_call_id', $call->id)->where('user_id', $me->id)->whereNull('left_at')
            ->update(['seen_at' => now()]);
        abort_if($updated === 0 || $call->ended_at !== null, 410, 'You are no longer in this call.');

        return response()->json($this->state($call, $me->id));
    }

    public function leave(Request $request, string $uuid): JsonResponse
    {
        $me = $request->user();
        $call = $this->call($request, $uuid);
        GroupCallParticipant::where('group_call_id', $call->id)->where('user_id', $me->id)->update(['left_at' => now()]);
        $left = $call->present()->pluck('user_id');
        foreach ($left as $id) {
            UserSignal::dispatch($id, 'groupcall.left', ['call_uuid' => $call->call_uuid, 'user_id' => $me->id]);
        }
        if ($left->isEmpty() && ! $call->ended_at) {
            $this->end($call);
        }

        return response()->json(['ok' => true]);
    }

    // ---- Helpers ----------------------------------------------------------------------------------

    private function mayCall($me, Conversation $conversation, string $type): void
    {
        abort_if($conversation->type === 'direct' || $conversation->isCommunity(), 422, 'Group calls are for group chats.');
        abort_unless($conversation->membershipFor($me), 403, 'You are not in this group.');
        abort_unless(Modules::conversationVisible($me->institution, $conversation), 403, 'This group is switched off.');
        abort_unless(Access::can($me, $type === 'video' ? 'calls.video' : 'calls.voice'), 403, 'Calls are turned off for you.');
        abort_unless(Modules::enabled($me->institution, $type === 'video' ? 'video_calls' : 'voice_calls'), 403, 'Calls are switched off in your institution.');
        abort_unless(Modules::enabled($me->institution, 'group_calls'), 403, 'Group calls are switched off in your institution.');
    }

    private function call(Request $request, string $uuid): GroupCall
    {
        $call = GroupCall::with('conversation')->where('call_uuid', $uuid)->firstOrFail();
        abort_unless($call->conversation && $call->conversation->membershipFor($request->user()), 403);

        return $call;
    }

    /** The call running in a group, closing any whose everyone has dropped. */
    private function running(Conversation $conversation): ?GroupCall
    {
        foreach (GroupCall::where('conversation_id', $conversation->id)->whereNull('ended_at')->get() as $call) {
            if ($call->present()->exists()) {
                return $call;
            }
            $this->end($call);
        }

        return null;
    }

    private function end(GroupCall $call): void
    {
        $call->update(['ended_at' => now()]);
        GroupCallParticipant::where('group_call_id', $call->id)->whereNull('left_at')->update(['left_at' => now()]);
        // The card in the chat now shows the call as over.
        Message::where('conversation_id', $call->conversation_id)->where('client_id', $call->call_uuid)->get()
            ->each(function (Message $m) use ($call) {
                // edited_at makes phones pick the change up on their next sync.
                $m->update(['edited_at' => now(), 'meta' => array_replace_recursive($m->meta ?? [], ['call' => ['ended' => true,
                    'duration_s' => (int) $call->started_at->diffInSeconds(now(), true)]])]);
                \App\Events\MessageCreated::dispatch($m, 'message.updated');
            });
    }

    private function state(GroupCall $call, int $me): array
    {
        $present = $call->present()->with('user:id,name')->get();

        return [
            'call_uuid' => $call->call_uuid, 'type' => $call->type, 'conversation_id' => $call->conversation_id,
            'conversation_name' => $call->conversation?->name, 'active' => $call->ended_at === null && $present->isNotEmpty(),
            'started_at' => $call->started_at->toIso8601String(), 'max' => (int) config('sos.calls.group_max'),
            'participants' => $present->map(fn ($p) => ['id' => $p->user_id, 'name' => $p->user?->name ?? 'Member'])->values(),
            'in_call' => $present->contains('user_id', $me),
        ];
    }

    private function ringPayload(GroupCall $call, Conversation $conversation, $me): array
    {
        return ['call_uuid' => $call->call_uuid, 'type' => $call->type, 'conversation_id' => $conversation->id,
            'conversation_name' => $conversation->name, 'caller' => ['id' => $me->id, 'name' => $me->name]];
    }
}
