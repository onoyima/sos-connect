<?php

namespace App\Http\Controllers\Api;

use App\Events\UserSignal;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\CallLog;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * 1-to-1 voice/video calls. The server only relays WebRTC signalling and keeps a call log; audio/video
 * flows phone-to-phone (or through our TURN relay when networks block direct paths). On a shared Wi-Fi
 * with no internet, phones do the same signalling directly over the LAN (see mobile/src/mesh/lan.ts).
 */
class CallController extends Controller
{
    public function iceServers(Request $request): JsonResponse
    {
        $host = config('sos.calls.turn_host');
        $secret = config('sos.calls.turn_secret');
        $servers = [['urls' => 'stun:stun.l.google.com:19302']];
        if ($host && $secret) {
            $ttl = config('sos.calls.turn_ttl');
            $username = (time() + $ttl).':'.$request->user()->id;
            $credential = base64_encode(hash_hmac('sha1', $username, $secret, true));
            $servers = [
                ['urls' => "stun:{$host}:3478"],
                ['urls' => ["turn:{$host}:3478?transport=udp", "turn:{$host}:3478?transport=tcp", "turns:{$host}:5349?transport=tcp"],
                    'username' => $username, 'credential' => $credential],
            ];
        }

        return response()->json(['iceServers' => $servers]);
    }

    public function index(Request $request): JsonResponse
    {
        $me = $request->user()->id;
        $calls = CallLog::with(['caller:id,name', 'callee:id,name'])
            ->where(fn ($q) => $q->where('caller_id', $me)->orWhere('callee_id', $me))
            ->latest('started_at')->limit(50)->get();

        // Group calls I was in.
        $group = \App\Models\GroupCall::with('conversation:id,name')
            ->whereIn('id', \App\Models\GroupCallParticipant::where('user_id', $me)->select('group_call_id'))
            ->latest('started_at')->limit(50)->get()
            ->map(fn ($g) => [
                'call_uuid' => $g->call_uuid, 'type' => $g->type, 'status' => $g->ended_at ? 'ended' : 'active', 'via' => 'online',
                'direction' => $g->started_by === $me ? 'outgoing' : 'incoming', 'other' => null,
                'group' => ['conversation_id' => $g->conversation_id, 'name' => $g->conversation?->name ?? 'Group'],
                'started_at' => $g->started_at->toIso8601String(),
                'duration_s' => $g->ended_at ? (int) $g->ended_at->diffInSeconds($g->started_at, true) : null,
            ]);

        return response()->json(['calls' => $calls->map(fn ($c) => [
            'call_uuid' => $c->call_uuid, 'type' => $c->type, 'via' => $c->via,
            'status' => $c->status === 'ringing' && $c->started_at->lt(now()->subMinutes(2)) ? 'missed' : $c->status,
            'direction' => $c->caller_id === $me ? 'outgoing' : 'incoming',
            'other' => $c->caller_id === $me ? $c->callee?->only(['id', 'name']) : $c->caller?->only(['id', 'name']),
            'started_at' => $c->started_at->toIso8601String(),
            'duration_s' => $c->answered_at && $c->ended_at ? $c->ended_at->diffInSeconds($c->answered_at, true) : null,
        ])->concat($group)->sortByDesc('started_at')->values()->take(60)]);
    }

    /** A call ringing for me right now (the app was closed when it started: opening it shows the call). */
    public function pending(Request $request): JsonResponse
    {
        $c = CallLog::with('caller:id,name')->where('callee_id', $request->user()->id)->where('status', 'ringing')
            ->where('started_at', '>', now()->subSeconds(45))->latest('started_at')->first();

        return response()->json(['call' => $c && $c->caller ? ['call_uuid' => $c->call_uuid, 'type' => $c->type, 'caller' => $c->caller->only(['id', 'name'])] : null]);
    }

    /** Opening the calls list clears the missed-call count. */
    public function seen(Request $request): JsonResponse
    {
        $request->user()->forceFill(['calls_seen_at' => now()])->save();

        return response()->json(['ok' => true]);
    }

    public function start(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['callee_id' => 'required|integer', 'type' => 'required|in:voice,video', 'via' => 'nullable|in:online,lan', 'call_uuid' => 'nullable|uuid']);
        abort_unless(Permissions::allows($me, $data['type'] === 'video' ? 'calls.video' : 'calls.voice'), 403, 'Calls are turned off for you.');
        abort_unless(\App\Support\Modules::enabled($me->institution, $data['type'] === 'video' ? 'video_calls' : 'voice_calls'), 403,
            ($data['type'] === 'video' ? 'Video' : 'Voice').' calls are switched off by your institution.');
        $callee = $me->colleagues()->findOrFail($data['callee_id']);
        abort_if($callee->id === $me->id, 422);
        // Calls follow the chat rules: you can call someone you can chat with (directly or after they accepted a request).
        [$mode, $why] = \App\Services\Chat\ContactPolicy::decide($me, $callee);
        abort_if($mode === \App\Services\Chat\ContactPolicy::REQUEST, 403, "Send {$callee->name} a chat request first. You can call once they accept.");
        abort_if($mode === \App\Services\Chat\ContactPolicy::NONE, 403, $why ?? 'You cannot call this person.');

        $recent = CallLog::where('started_at', '>', now()->subMinute())->where('caller_id', $me->id)->count();
        abort_if($recent >= 5, 429, 'Too many calls. Wait a minute.');

        $busy = CallLog::whereIn('status', ['ringing', 'answered'])->where('started_at', '>', now()->subHours(3))
            ->where(fn ($q) => $q->where('caller_id', $callee->id)->orWhere('callee_id', $callee->id))->exists();

        $log = CallLog::create(['call_uuid' => $data['call_uuid'] ?? (string) Str::uuid(), 'caller_id' => $me->id, 'callee_id' => $callee->id,
            'type' => $data['type'], 'status' => $busy ? 'busy' : 'ringing', 'via' => $data['via'] ?? 'online', 'started_at' => now()]);

        if ($busy) {
            return response()->json(['call_uuid' => $log->call_uuid, 'status' => 'busy'], 409);
        }

        UserSignal::dispatch($callee->id, 'call.incoming', ['call_uuid' => $log->call_uuid, 'type' => $log->type,
            'caller' => ['id' => $me->id, 'name' => $me->name]]);
        SendPush::dispatchAfterResponse([$callee->id], 'Incoming '.$log->type.' call', $me->name.' is calling',
            ['type' => 'call', 'call_uuid' => $log->call_uuid], true);

        return response()->json(['call_uuid' => $log->call_uuid, 'status' => 'ringing'], 201);
    }

    public function signal(Request $request, string $uuid): JsonResponse
    {
        $log = $this->party($request, $uuid);
        $data = $request->validate(['data' => 'required|array']);
        abort_if(strlen(json_encode($data['data'])) > 16_000, 413);
        UserSignal::dispatch($this->other($log, $request->user()->id), 'call.signal', ['call_uuid' => $uuid, 'data' => $data['data']]);

        return response()->json(['ok' => true]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $log = $this->party($request, $uuid);
        $action = $request->validate(['action' => 'required|in:answer,reject,end,missed,failed'])['action'];
        $updates = match ($action) {
            'answer' => ['status' => 'answered', 'answered_at' => now()],
            'reject' => ['status' => 'rejected', 'ended_at' => now()],
            'missed' => ['status' => 'missed', 'ended_at' => now()],
            'failed' => ['status' => 'failed', 'ended_at' => now()],
            'end' => ['status' => $log->answered_at ? 'ended' : 'missed', 'ended_at' => now()],
        };
        $log->update($updates);
        UserSignal::dispatch($this->other($log, $request->user()->id), 'call.state', ['call_uuid' => $uuid, 'status' => $log->status]);
        if ($log->status === 'missed') {
            SendPush::dispatchAfterResponse([$log->callee_id], 'Missed call', ($log->caller?->name ?? 'Someone').' called you', ['type' => 'call_missed']);
        }

        return response()->json(['status' => $log->status]);
    }

    private function party(Request $request, string $uuid): CallLog
    {
        $log = CallLog::where('call_uuid', $uuid)->firstOrFail();
        abort_unless(in_array($request->user()->id, [$log->caller_id, $log->callee_id], true), 403);

        return $log;
    }

    private function other(CallLog $log, int $me): int
    {
        return $log->caller_id === $me ? $log->callee_id : $log->caller_id;
    }
}
