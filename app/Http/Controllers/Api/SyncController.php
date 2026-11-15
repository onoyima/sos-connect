<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Message;
use App\Models\SafetyCheck;
use App\Models\SafetyCheckResponse;
use App\Models\SosAlert;
use App\Services\Chat\MessageService;
use App\Services\Mesh\MeshKeyring;
use App\Services\Sos\SosService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * Delta sync for the phone — the main reason the app uses little data. One small request returns only
 * what changed since the phone's cursor; one request flushes everything the phone wrote while offline.
 */
class SyncController extends Controller
{
    public function pull(Request $request, MeshKeyring $keys): JsonResponse
    {
        $me = $request->user();
        $cursor = (int) $request->query('cursor', 0);
        $since = $request->query('since') ? now()->parse($request->query('since')) : now()->subDays(7);

        $convIds = ConversationMember::where('user_id', $me->id)->pluck('conversation_id');
        $messages = Message::withTrashed()->with(['sender:id,name', 'replyTo'])->whereIn('conversation_id', $convIds)
            ->where('id', '>', $cursor)->orderBy('id')->limit(300)->get();

        // Older messages edited or deleted since the last pull (new ones come through the cursor above).
        $changed = $request->query('since') ? Message::withTrashed()->with(['sender:id,name', 'replyTo'])->whereIn('conversation_id', $convIds)
            ->where('id', '<=', $cursor)->where(fn ($q) => $q->where('edited_at', '>', $since)->orWhere('deleted_at', '>', $since))
            ->orderByDesc('id')->limit(200)->get() : collect();

        $changedConversations = Conversation::whereIn('id', $convIds)->where('updated_at', '>', $since)->get(['id', 'type', 'name', 'posting']);
        $allSos = \App\Support\Access::can($me, 'sos.view');

        $sos = SosAlert::with(['user.department', 'responses.user'])->visibleTo($me)
            ->where(fn ($q) => $q->where('user_id', $me->id)->orWhereIn('status', SosAlert::OPEN_STATES))
            ->where('updated_at', '>', $since)->limit(100)->get();

        $answered = SafetyCheckResponse::where('user_id', $me->id)->pluck('safety_check_id');
        $checks = SafetyCheck::where('closes_at', '>', now())->whereNotIn('id', $answered)->get()
            ->filter(fn ($c) => SafetyCheckController::inAudienceStatic($c->audience, $me));

        $announcements = Announcement::where('published_at', '>', $since)->latest('published_at')->limit(50)->get()
            ->filter(fn ($a) => SafetyCheckController::inAudienceStatic($a->audience, $me));

        return response()->json([
            'cursor' => $messages->last()?->id ?? $cursor,
            'more' => $messages->count() === 300,
            'server_time' => now()->toIso8601String(),
            'messages' => $messages->concat($changed)->map->toClient()->values(),
            'conversations' => $changedConversations,
            'sos' => $sos->map(fn ($a) => $a->toClient($allSos)),
            'safety_checks' => $checks->map(fn ($c) => ['uuid' => $c->uuid, 'title' => $c->title, 'message' => $c->message, 'closes_at' => $c->closes_at->toIso8601String()])->values(),
            'announcements' => $announcements->map(fn ($a) => ['id' => $a->id, 'title' => $a->title, 'body' => $a->body, 'priority' => $a->priority, 'published_at' => $a->published_at->toIso8601String()])->values(),
            'mesh_keys' => $request->boolean('keys') ? $keys->forDevice($me->institution_id) : null,
        ]);
    }

    public function push(Request $request, MessageService $messageService, SosService $sosService): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'messages' => 'array|max:200', 'messages.*.conversation_id' => 'required|integer', 'messages.*.client_id' => 'required|uuid',
            'messages.*.type' => 'required|in:text,image,voice,file,sticker', 'messages.*.body' => 'nullable|string|max:4000',
            'messages.*.meta' => 'nullable|array', 'messages.*.sent_at' => 'nullable|date',
            'messages.*.reply_to_id' => 'nullable|integer', 'messages.*.mentions' => 'nullable|array|max:50', 'messages.*.mentions.*' => 'integer',
            'sos' => 'array|max:20', 'sos.*.client_id' => 'required|uuid', 'sos.*.category' => 'required|string',
            'sos_updates' => 'array|max:50', 'sos_updates.*.alert_uuid' => 'required|uuid', 'sos_updates.*.action' => 'required|string',
            'safety' => 'array|max:20', 'safety.*.check_uuid' => 'required|uuid', 'safety.*.answer' => 'required|in:safe,need_help',
            'reads' => 'array|max:200', 'reads.*.conversation_id' => 'required|integer', 'reads.*.last_read_message_id' => 'required|integer',
        ]);

        $results = ['messages' => [], 'sos' => [], 'sos_updates' => [], 'safety' => []];

        // SOS first: if this request is cut off, the alert must already be in.
        foreach ($data['sos'] ?? [] as $s) {
            $results['sos'][$s['client_id']] = $this->attempt(fn () => ['uuid' => $sosService->raise($me, $s, 'online')->uuid]);
        }
        foreach ($data['sos_updates'] ?? [] as $u) {
            $results['sos_updates'][] = $this->attempt(function () use ($u, $me, $sosService) {
                $alert = SosAlert::where('uuid', $u['alert_uuid'])->firstOrFail();
                $sosService->respond($alert, $me, $u['action'], $u['note'] ?? null, $u['lat'] ?? null, $u['lng'] ?? null);

                return ['ok' => true];
            });
        }
        foreach ($data['safety'] ?? [] as $r) {
            $results['safety'][$r['check_uuid']] = $this->attempt(function () use ($r, $me) {
                $check = SafetyCheck::where('uuid', $r['check_uuid'])->firstOrFail();
                SafetyCheckResponse::updateOrCreate(['safety_check_id' => $check->id, 'user_id' => $me->id],
                    ['answer' => $r['answer'], 'note' => $r['note'] ?? null, 'lat' => $r['lat'] ?? null, 'lng' => $r['lng'] ?? null, 'via' => 'online', 'responded_at' => now()]);

                return ['ok' => true];
            });
        }
        foreach ($data['messages'] ?? [] as $m) {
            $results['messages'][$m['client_id']] = $this->attempt(function () use ($m, $me, $messageService) {
                $conversation = Conversation::findOrFail($m['conversation_id']);

                return ['id' => $messageService->send($me, $conversation, $m, ($m['meta']['via_mesh'] ?? false) ? 'mesh' : 'online')->id];
            });
        }
        foreach ($data['reads'] ?? [] as $r) {
            ConversationMember::where('conversation_id', $r['conversation_id'])->where('user_id', $me->id)
                ->where(fn ($q) => $q->whereNull('last_read_message_id')->orWhere('last_read_message_id', '<', $r['last_read_message_id']))
                ->update(['last_read_message_id' => $r['last_read_message_id']]);
        }

        return response()->json(['results' => $results]);
    }

    private function attempt(callable $fn): array
    {
        try {
            return ['ok' => true] + $fn();
        } catch (Throwable $e) {
            return ['ok' => false, 'error' => $e instanceof \Illuminate\Auth\Access\AuthorizationException ? $e->getMessage() : 'rejected'];
        }
    }
}
