<?php

namespace App\Http\Controllers\Api;

use App\Events\UserSignal;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\ChatRequest;
use App\Models\User;
use App\Services\Chat\ContactPolicy;
use App\Services\Chat\DirectChats;
use App\Services\Chat\MessageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * "May I chat with you?" For people who can't message someone straight away (see ContactPolicy): the other
 * person accepts (the chat opens, with the note as its first message, and calls work too) or declines.
 */
class ChatRequestController extends Controller
{
    private const PER_DAY = 30;

    private const AFTER_DECLINE_DAYS = 7;

    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        $present = fn (ChatRequest $r, User $who) => ['id' => $r->id, 'message' => $r->message, 'status' => $r->status,
            'created_at' => $r->created_at->toIso8601String(), 'person' => $who->publicProfile($me)];

        return response()->json([
            'incoming' => ChatRequest::with('sender')->where('to_id', $me->id)->where('status', 'pending')->latest()->limit(100)->get()
                ->filter(fn ($r) => $r->sender && $r->sender->isActive())->map(fn ($r) => $present($r, $r->sender))->values(),
            'outgoing' => ChatRequest::with('recipient')->where('from_id', $me->id)->where('status', 'pending')->latest()->limit(100)->get()
                ->filter(fn ($r) => $r->recipient)->map(fn ($r) => $present($r, $r->recipient))->values(),
            // Answers to my requests I haven't looked at yet (accepted: open the chat; declined: they can't chat now).
            'responses' => ChatRequest::with('recipient')->where('from_id', $me->id)->whereIn('status', ['accepted', 'declined'])
                ->whereNull('sender_seen_at')->where('responded_at', '>', now()->subDays(14))->latest('responded_at')->limit(50)->get()
                ->filter(fn ($r) => $r->recipient)->map(fn ($r) => $present($r, $r->recipient) + [
                    'conversation_id' => $r->conversation_id, 'responded_at' => $r->responded_at?->toIso8601String(),
                ])->values(),
        ]);
    }

    /** I've seen the answers to my requests (clears them from the list and the red count). */
    public function seen(Request $request): JsonResponse
    {
        $ids = $request->validate(['ids' => 'nullable|array', 'ids.*' => 'integer'])['ids'] ?? null;
        ChatRequest::where('from_id', $request->user()->id)->whereIn('status', ['accepted', 'declined'])->whereNull('sender_seen_at')
            ->when($ids, fn ($q) => $q->whereIn('id', $ids))->update(['sender_seen_at' => now()]);

        return response()->json(['ok' => true]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['user_id' => 'required|integer', 'message' => 'nullable|string|max:300']);
        $peer = $me->colleagues()->findOrFail($data['user_id']);

        [$mode, $why] = ContactPolicy::decide($me, $peer);
        if ($mode === ContactPolicy::REQUEST && ! \App\Support\Modules::enabled($me->institution, 'chat_requests')) {
            abort(403, "Chat requests are switched off by your institution, so you can't start a chat with {$peer->name}.");
        }
        if ($mode === ContactPolicy::DIRECT) {
            // No request needed: open the chat.
            return response()->json(['conversation_id' => DirectChats::open($me, $peer)->id, 'status' => 'open']);
        }
        abort_if($mode === ContactPolicy::NONE, 403, $why ?? 'You cannot chat with this person.');

        // They already asked me: asking back means yes.
        $theirs = ChatRequest::where('from_id', $peer->id)->where('to_id', $me->id)->where('status', 'pending')->first();
        if ($theirs) {
            return $this->accept($request, $theirs->id, app(MessageService::class));
        }
        $mine = ChatRequest::where('from_id', $me->id)->where('to_id', $peer->id)->where('status', 'pending')->first();
        if ($mine) {
            return response()->json(['request' => ['id' => $mine->id, 'status' => 'pending']]);
        }
        $declined = ChatRequest::where('from_id', $me->id)->where('to_id', $peer->id)->where('status', 'declined')
            ->where('responded_at', '>', now()->subDays(self::AFTER_DECLINE_DAYS))->exists();
        abort_if($declined, 429, "{$peer->name} didn't accept your last request. You can ask again after a few days.");
        $today = ChatRequest::where('from_id', $me->id)->where('created_at', '>', now()->subDay())->count();
        abort_if($today >= self::PER_DAY, 429, 'You have sent a lot of chat requests today. Try again tomorrow.');

        $r = ChatRequest::create(['institution_id' => $me->institution_id, 'from_id' => $me->id, 'to_id' => $peer->id,
            'message' => isset($data['message']) ? (trim($data['message']) ?: null) : null, 'status' => 'pending']);

        UserSignal::dispatch($peer->id, 'chat_request.received', ['id' => $r->id, 'from' => ['id' => $me->id, 'name' => $me->name], 'message' => $r->message]);
        SendPush::dispatchAfterResponse([$peer->id], "{$me->name} wants to chat with you", $r->message ?: 'Open SOS Connect to accept or decline.',
            ['type' => 'chat_request', 'request_id' => $r->id]);

        return response()->json(['request' => ['id' => $r->id, 'status' => 'pending']], 201);
    }

    public function accept(Request $request, int $id, MessageService $messages): JsonResponse
    {
        $me = $request->user();
        $r = ChatRequest::with('sender')->where('to_id', $me->id)->where('status', 'pending')->findOrFail($id);
        abort_unless($r->sender && $r->sender->isActive(), 410, 'That person can no longer be reached here.');

        $conversation = DB::transaction(function () use ($r, $me, $messages) {
            $c = DirectChats::open($r->sender, $me, accepted: true);
            $r->update(['status' => 'accepted', 'responded_at' => now(), 'conversation_id' => $c->id]);
            if ($r->message) {
                // Their note becomes the first message of the chat.
                $messages->send($r->sender, $c, ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => $r->message]);
            }

            return $c;
        });

        UserSignal::dispatch($r->from_id, 'chat_request.accepted', ['id' => $r->id, 'conversation_id' => $conversation->id, 'by' => ['id' => $me->id, 'name' => $me->name]]);
        SendPush::dispatchAfterResponse([$r->from_id], "{$me->name} accepted your chat request", 'You can chat and call now.',
            ['type' => 'message', 'conversation_id' => $conversation->id]);

        return response()->json(['conversation_id' => $conversation->id, 'status' => 'accepted']);
    }

    public function decline(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $r = ChatRequest::where('to_id', $me->id)->where('status', 'pending')->findOrFail($id);
        $r->update(['status' => 'declined', 'responded_at' => now()]);
        // The sender is told (gently), so they aren't left waiting.
        UserSignal::dispatch($r->from_id, 'chat_request.declined', ['id' => $r->id, 'by' => ['id' => $me->id, 'name' => $me->name]]);
        SendPush::dispatchAfterResponse([$r->from_id], 'Chat request', "{$me->name} can't chat right now.", ['type' => 'chat_request']);

        return response()->json(['status' => 'declined']);
    }

    public function cancel(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $r = ChatRequest::where('from_id', $me->id)->where('status', 'pending')->findOrFail($id);
        $r->update(['status' => 'cancelled', 'responded_at' => now()]);
        UserSignal::dispatch($r->to_id, 'chat_request.updated', ['id' => $r->id]);

        return response()->json(['status' => 'cancelled']);
    }
}
