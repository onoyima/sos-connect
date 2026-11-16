<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Message;
use App\Models\MessageReport;
use App\Services\Chat\MessageService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    public function store(Request $request, Conversation $conversation, MessageService $service): JsonResponse
    {
        $data = $request->validate([
            'client_id' => 'required|uuid',
            'type' => 'required|in:text,image,voice,file,sticker',
            'body' => 'nullable|string|max:4000|required_if:type,text',
            'meta' => 'nullable|array',
            'meta.path' => 'nullable|string|max:255',
            'meta.duration' => 'nullable|numeric',
            'meta.size' => 'nullable|integer',
            // Every key the apps send needs its own rule: Laravel drops keys of a checked array that have none.
            'meta.mime' => 'nullable|string|max:100',
            'meta.sticker' => 'nullable|string|max:40',
            'reply_to_id' => 'nullable|integer',
            'mentions' => 'nullable|array|max:50', 'mentions.*' => 'integer',
            'sent_at' => 'nullable|date',
        ]);

        $message = $service->send($request->user(), $conversation, $data);

        return response()->json(['message' => $message->toClient()], 201);
    }

    public function update(Request $request, Message $message): JsonResponse
    {
        abort_unless($message->sender_id === $request->user()->id, 403, 'Only the sender can edit.');
        abort_if($message->created_at->lt(now()->subMinutes(15)), 422, 'Messages can be edited for 15 minutes.');
        $message->update(['body' => $request->validate(['body' => 'required|string|max:4000'])['body'], 'edited_at' => now()]);
        $this->notifyChange($message, 'message.updated');

        return response()->json(['message' => $message->toClient()]);
    }

    public function destroy(Request $request, Message $message): JsonResponse
    {
        $me = $request->user();
        $conversation = $message->conversation()->first();
        $groupAdmin = $conversation && $conversation->manageableBy($me, 'delete_messages');
        abort_unless($message->sender_id === $me->id || $groupAdmin, 403);
        // Like editing: your own messages can be deleted for everyone within 15 minutes (group admins can remove any message).
        abort_if(! $groupAdmin && $message->created_at->lt(now()->subMinutes(15)), 422, 'Messages can be deleted for everyone within 15 minutes of sending.');
        $message->delete(); // soft delete: content hidden, row kept for receipts/report integrity, purged by retention
        $this->notifyChange($message, 'message.deleted');

        return response()->json(['ok' => true]);
    }

    /**
     * Forward a message to other chats and groups (up to 10). The copy is marked "Forwarded"; who wrote it first is
     * not shown, as on WhatsApp. Each chat's own rules still apply (members only, admins-only groups, files allowed…).
     */
    public function forward(Request $request, Message $message, MessageService $service): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['conversation_ids' => 'required|array|min:1|max:10', 'conversation_ids.*' => 'integer|distinct']);
        $from = $message->conversation()->first();
        abort_unless($from && $from->membershipFor($me), 404);
        abort_if($message->trashed() || in_array($message->type, ['system'], true), 422, 'This message can\'t be forwarded.');

        $meta = array_diff_key($message->meta ?? [], array_flip(['mentions', 'status_reply', 'call', 'forwarded'])) + ['forwarded' => true];
        $sent = [];
        $failed = [];
        foreach (\App\Models\Conversation::whereIn('id', $data['conversation_ids'])->get() as $to) {
            try {
                $m = $service->send($me, $to, ['client_id' => (string) \Illuminate\Support\Str::uuid(), 'type' => $message->type,
                    'body' => $message->body, 'meta' => $meta]);
                $sent[] = ['conversation_id' => $to->id, 'message' => $m->toClient()];
            } catch (\Illuminate\Auth\Access\AuthorizationException $e) {
                $failed[] = ['conversation_id' => $to->id, 'reason' => $e->getMessage()];
            }
        }

        return response()->json(['sent' => $sent, 'failed' => $failed]);
    }

    public function report(Request $request, Message $message): JsonResponse
    {
        abort_unless(ConversationMember::where('conversation_id', $message->conversation_id)->where('user_id', $request->user()->id)->exists(), 403);
        MessageReport::create(['reporter_id' => $request->user()->id, 'target_type' => 'message', 'target_id' => $message->id,
            'reason' => $request->validate(['reason' => 'required|string|min:5|max:500'])['reason']]);

        return response()->json(['ok' => true], 201);
    }

    private function notifyChange(Message $message, string $kind): void
    {
        \App\Events\MessageCreated::dispatch($message, $kind);
    }
}
