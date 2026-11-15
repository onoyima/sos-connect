<?php

namespace App\Http\Controllers\Api;

use App\Events\UserSignal;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\ConversationMember;
use App\Models\StatusComment;
use App\Models\StatusUpdate;
use App\Models\User;
use App\Services\Chat\DirectChats;
use App\Services\Chat\MessageService;
use App\Support\Access;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Status updates (text, photo, GIF, video or audio) with an audience the poster chooses:
 *   contacts    = people I have ever chatted with one-to-one (default)
 *   department  = my department          faculty = my faculty
 *   groups      = members of groups I choose (that I'm in)
 *   selected    = people I choose
 *   institution = everyone at my institution (can be limited by the institution)
 * and, whatever the audience, minus anyone I hide it from.
 * People tagged in a status can always see it. Anyone who can see a status can like or love it, comment on it,
 * reply to a comment, or reply privately (which goes to a one-to-one chat with the poster).
 */
class StatusController extends Controller
{
    public const REACTIONS = ['like', 'love'];

    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        $statuses = $this->visibleTo($me)->with(['user:id,name', 'mentioned:users.id,name'])
            ->withCount('comments')->latest()->limit(200)->get();
        $ids = $statuses->pluck('id');

        $viewed = DB::table('status_views')->where('viewer_id', $me->id)->whereIn('status_update_id', $ids)->pluck('status_update_id')->flip();
        $counts = DB::table('status_reactions')->whereIn('status_update_id', $ids)
            ->select('status_update_id', 'reaction', DB::raw('count(*) as n'))->groupBy('status_update_id', 'reaction')->get()
            ->groupBy('status_update_id');
        $mine = DB::table('status_reactions')->where('user_id', $me->id)->whereIn('status_update_id', $ids)->pluck('reaction', 'status_update_id');
        $views = DB::table('status_views')->whereIn('status_update_id', $statuses->where('user_id', $me->id)->pluck('id'))
            ->select('status_update_id', DB::raw('count(*) as n'))->groupBy('status_update_id')->pluck('n', 'status_update_id');

        return response()->json(['statuses' => $statuses->map(fn (StatusUpdate $s) => $this->present($s, $me, [
            'viewed' => isset($viewed[$s->id]),
            'reactions' => $this->reactionCounts($counts->get($s->id)),
            'my_reaction' => $mine[$s->id] ?? null,
            'view_count' => $s->user_id === $me->id ? (int) ($views[$s->id] ?? 0) : null,
        ]))]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        abort_unless(Permissions::allows($me, 'status.post'), 403, 'Posting status updates is turned off for you.');
        $data = $request->validate([
            'body' => 'nullable|string|max:700|required_without:media_path',
            'media_path' => 'nullable|string|max:255|starts_with:uploads/'.$me->institution_id.'/',
            'background' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'audience' => 'required|in:contacts,department,faculty,groups,selected,institution',
            'group_ids' => 'array|max:20|required_if:audience,groups', 'group_ids.*' => 'integer',
            'people' => 'array|max:500|required_if:audience,selected', 'people.*' => 'integer',
            'hidden' => 'array|max:500', 'hidden.*' => 'integer',
            'mentions' => 'array|max:20',
            'mentions.*' => 'integer',
        ]);
        if ($data['audience'] === 'institution' && $me->institution->setting('status_audience_max') !== 'institution') {
            $data['audience'] = 'department';
        }
        $tagged = $me->colleagues()->whereIn('id', $data['mentions'] ?? [])->where('id', '!=', $me->id)->get(['id', 'name']);

        // What kind of media, from the file itself (the upload already checked its type).
        $mediaType = null;
        if (! empty($data['media_path'])) {
            abort_unless(\Illuminate\Support\Facades\Storage::disk('local')->exists($data['media_path']), 422, 'That file was not found. Upload it again.');
            $mime = (string) \Illuminate\Support\Facades\Storage::disk('local')->mimeType($data['media_path']);
            $mediaType = match (true) {
                $mime === 'image/gif' => 'gif',
                str_starts_with($mime, 'image/') => 'image',
                str_starts_with($mime, 'video/') => 'video',
                str_starts_with($mime, 'audio/') => 'audio',
                default => abort(422, 'A status can have a photo, GIF, video or audio.'),
            };
        }

        // Chosen groups (only ones I'm in) or chosen people (from my institution), as people.
        $audienceIds = match ($data['audience']) {
            'groups' => ConversationMember::whereIn('conversation_id', ConversationMember::where('user_id', $me->id)->whereIn('conversation_id', $data['group_ids'] ?? [])->pluck('conversation_id'))
                ->where('user_id', '!=', $me->id)->distinct()->limit(20000)->pluck('user_id')->all(),
            'selected' => $me->colleagues()->whereIn('id', $data['people'] ?? [])->where('id', '!=', $me->id)->pluck('id')->all(),
            default => [],
        };
        abort_if(in_array($data['audience'], ['groups', 'selected'], true) && ! $audienceIds, 422, 'Choose at least one group or person to share with.');
        $hidden = $me->colleagues()->whereIn('id', $data['hidden'] ?? [])->where('id', '!=', $me->id)->pluck('id')->all();

        $status = DB::transaction(function () use ($me, $data, $tagged, $mediaType, $audienceIds, $hidden) {
            $s = StatusUpdate::create([
                'user_id' => $me->id, 'body' => $data['body'] ?? null, 'media_path' => $data['media_path'] ?? null, 'media_type' => $mediaType,
                'background' => isset($data['media_path']) ? null : ($data['background'] ?? null),
                'audience' => $data['audience'], 'expires_at' => now()->addHours(config('sos.status.expiry_hours')),
            ]);
            $s->mentioned()->sync($tagged->pluck('id')->diff($hidden));
            foreach (array_chunk($audienceIds, 1000) as $chunk) {
                DB::table('status_audience')->insert(array_map(fn ($id) => ['status_update_id' => $s->id, 'user_id' => $id], $chunk));
            }
            foreach (array_chunk($hidden, 1000) as $chunk) {
                DB::table('status_hidden')->insert(array_map(fn ($id) => ['status_update_id' => $s->id, 'user_id' => $id], $chunk));
            }

            return $s;
        });
        $tagged = $tagged->whereNotIn('id', $hidden);

        $this->changed($status);
        if ($tagged->isNotEmpty()) {
            $this->notify($tagged->pluck('id')->all(), 'status.tagged', $status, "{$me->name} tagged you in a status", $this->preview($status));
        }

        return response()->json(['id' => $status->id], 201);
    }

    public function view(Request $request, StatusUpdate $status): JsonResponse
    {
        $me = $request->user();
        $this->mustSee($me, $status);
        if ($status->user_id !== $me->id) {
            DB::table('status_views')->insertOrIgnore(['status_update_id' => $status->id, 'viewer_id' => $me->id, 'viewed_at' => now()]);
        }

        return response()->json(['ok' => true]);
    }

    /** Who viewed it, and how each of them reacted. Only for the poster. */
    public function viewers(Request $request, StatusUpdate $status): JsonResponse
    {
        abort_unless($status->user_id === $request->user()->id, 403);
        $reactions = DB::table('status_reactions')->where('status_update_id', $status->id)->pluck('reaction', 'user_id');

        return response()->json(['viewers' => DB::table('status_views')->join('users', 'users.id', '=', 'status_views.viewer_id')
            ->where('status_update_id', $status->id)->orderByDesc('viewed_at')->get(['users.id', 'users.name', 'status_views.viewed_at'])
            ->map(fn ($v) => ['id' => $v->id, 'name' => $v->name, 'viewed_at' => $v->viewed_at, 'reaction' => $reactions[$v->id] ?? null])]);
    }

    /** Like, love, or take the reaction back (reaction: null). */
    public function react(Request $request, StatusUpdate $status): JsonResponse
    {
        $me = $request->user();
        abort_unless(\App\Support\Modules::enabled($me->institution, 'status_interactions'), 403, 'Likes, comments and replies on status are switched off.');
        $this->mustSee($me, $status);
        $reaction = $request->validate(['reaction' => 'nullable|in:'.implode(',', self::REACTIONS)])['reaction'] ?? null;

        $before = DB::table('status_reactions')->where('status_update_id', $status->id)->where('user_id', $me->id)->value('reaction');
        if ($reaction === null) {
            DB::table('status_reactions')->where('status_update_id', $status->id)->where('user_id', $me->id)->delete();
        } else {
            DB::table('status_reactions')->updateOrInsert(['status_update_id' => $status->id, 'user_id' => $me->id],
                ['reaction' => $reaction, 'updated_at' => now(), 'created_at' => now()]);
            if ($before === null && $status->user_id !== $me->id) {
                $this->notify([$status->user_id], 'status.reacted', $status, $me->name.($reaction === 'love' ? ' loved' : ' liked').' your status', $this->preview($status), push: false);
            }
        }

        $this->changed($status);

        return response()->json(['reactions' => $this->reactionCounts(DB::table('status_reactions')->where('status_update_id', $status->id)
            ->select('reaction', DB::raw('count(*) as n'))->groupBy('reaction')->get()), 'my_reaction' => $reaction]);
    }

    public function comments(Request $request, StatusUpdate $status): JsonResponse
    {
        $me = $request->user();
        $this->mustSee($me, $status);
        $list = $status->comments()->with(['user:id,name', 'replyTo.user:id,name'])->oldest('id')->limit(300)->get();

        return response()->json(['comments' => $list->map(fn ($c) => $this->comment($c, $me, $status))]);
    }

    public function comment(StatusComment $c, User $me, StatusUpdate $status): array
    {
        return [
            'id' => $c->id, 'user' => ['id' => $c->user_id, 'name' => $c->user?->name ?? 'Former member'], 'body' => $c->body,
            'reply_to' => $c->replyTo ? ['id' => $c->replyTo->id, 'name' => $c->replyTo->user?->name, 'body' => Str::limit($c->replyTo->body, 80)] : null,
            'created_at' => $c->created_at->toIso8601String(),
            'can_delete' => $this->canDeleteComment($me, $c, $status),
        ];
    }

    public function addComment(Request $request, StatusUpdate $status): JsonResponse
    {
        $me = $request->user();
        abort_unless(\App\Support\Modules::enabled($me->institution, 'status_interactions'), 403, 'Likes, comments and replies on status are switched off.');
        $this->mustSee($me, $status);
        $data = $request->validate(['body' => 'required|string|max:500', 'reply_to_id' => 'nullable|integer']);
        $replyTo = isset($data['reply_to_id']) ? $status->comments()->whereKey($data['reply_to_id'])->first() : null;

        $c = $status->comments()->create(['institution_id' => $status->institution_id, 'user_id' => $me->id,
            'reply_to_id' => $replyTo?->id, 'body' => trim($data['body'])]);
        $c->setRelation('user', $me);
        $c->setRelation('replyTo', $replyTo?->load('user:id,name'));

        $this->changed($status);
        $tell = array_values(array_unique(array_filter([$status->user_id, $replyTo?->user_id], fn ($id) => $id && $id !== $me->id)));
        if ($tell) {
            $title = $replyTo && $replyTo->user_id !== $status->user_id && in_array($replyTo->user_id, $tell, true)
                ? "{$me->name} replied to your comment" : "{$me->name} commented on your status";
            $this->notify($tell, 'status.commented', $status, $title, Str::limit($c->body, 100));
        }

        return response()->json(['comment' => $this->comment($c, $me, $status)], 201);
    }

    public function deleteComment(Request $request, StatusUpdate $status, StatusComment $comment): JsonResponse
    {
        abort_unless($comment->status_update_id === $status->id, 404);
        abort_unless($this->canDeleteComment($request->user(), $comment, $status), 403);
        $comment->delete();
        $this->changed($status);

        return response()->json(['ok' => true]);
    }

    /** "Reply" on someone's status: a private message to them, showing which status it's about. */
    public function reply(Request $request, StatusUpdate $status, MessageService $messages): JsonResponse
    {
        $me = $request->user();
        abort_unless(\App\Support\Modules::enabled($me->institution, 'status_interactions'), 403, 'Likes, comments and replies on status are switched off.');
        $this->mustSee($me, $status);
        abort_if($status->user_id === $me->id, 422, "You can't reply privately to your own status.");
        $data = $request->validate(['body' => 'required|string|max:4000']);
        $owner = User::findOrFail($status->user_id);

        $conversation = DirectChats::open($me, $owner);
        $message = $messages->send($me, $conversation, [
            'client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => $data['body'],
            'meta' => ['status_reply' => ['id' => $status->id, 'preview' => $this->preview($status), 'media_path' => $status->media_path,
                'background' => $status->background]],
        ]);

        return response()->json(['conversation_id' => $conversation->id, 'message' => $message->toClient()], 201);
    }

    public function destroy(Request $request, StatusUpdate $status): JsonResponse
    {
        $me = $request->user();
        $owner = $status->user_id === $me->id ? $me : User::find($status->user_id);
        abort_unless($status->user_id === $me->id || ($owner && Access::canOnUser($me, 'status.delete', $owner)), 403);
        $status->delete();
        $this->changed($status);

        return response()->json(['ok' => true]);
    }

    // ---- Helpers ----------------------------------------------------------------------------------

    /** Live statuses this person may see. */
    private function visibleTo(User $me): Builder
    {
        $contactIds = $this->contactIds($me->id);

        $hidden = DB::table('status_hidden')->where('user_id', $me->id)->select('status_update_id');
        $shared = DB::table('status_audience')->where('user_id', $me->id)->select('status_update_id');

        return StatusUpdate::query()->where('expires_at', '>', now())
            ->where(fn ($q) => $q->where('user_id', $me->id)
                ->orWhere(fn ($others) => $others->whereNotIn('id', $hidden)->where(fn ($a) => $a
                    ->where('audience', 'institution')
                    ->orWhere(fn ($w) => $w->where('audience', 'contacts')->whereIn('user_id', $contactIds))
                    ->orWhere(fn ($w) => $w->where('audience', 'department')->whereNotNull('user_id')
                        ->whereHas('user', fn ($u) => $u->whereNotNull('department_unit_id')->where('department_unit_id', $me->department_unit_id)))
                    ->orWhere(fn ($w) => $w->where('audience', 'faculty')->whereNotNull('user_id')
                        ->whereHas('user', fn ($u) => $u->whereNotNull('faculty_unit_id')->where('faculty_unit_id', $me->faculty_unit_id)))
                    ->orWhere(fn ($w) => $w->whereIn('audience', ['groups', 'selected'])->whereIn('id', $shared))
                    ->orWhereHas('mentioned', fn ($m) => $m->where('users.id', $me->id)))));
    }

    private function mustSee(User $me, StatusUpdate $status): void
    {
        abort_unless($this->visibleTo($me)->whereKey($status->id)->exists(), 404, 'This status has expired or is not shared with you.');
    }

    private function canDeleteComment(User $me, StatusComment $c, StatusUpdate $status): bool
    {
        if ($c->user_id === $me->id || $status->user_id === $me->id) {
            return true;
        }
        $author = $c->relationLoaded('user') ? $c->user : User::find($c->user_id);

        return $author && Access::canOnUser($me, 'status.delete', $author);
    }

    private function present(StatusUpdate $s, User $me, array $extra): array
    {
        return [
            'id' => $s->id, 'user' => ['id' => $s->user_id, 'name' => $s->user?->name ?? 'Former member'], 'body' => $s->body,
            'media_path' => $s->media_path, 'media_type' => $s->media_path ? ($s->media_type ?? 'image') : null, 'background' => $s->background,
            'audience' => $s->user_id === $me->id ? $s->audience : null,
            'mentions' => $s->mentioned->map(fn ($u) => ['id' => $u->id, 'name' => $u->name])->values(),
            'comment_count' => (int) $s->comments_count,
            'expires_at' => $s->expires_at->toIso8601String(), 'created_at' => $s->created_at->toIso8601String(),
        ] + $extra;
    }

    private function reactionCounts($rows): array
    {
        $out = array_fill_keys(self::REACTIONS, 0);
        foreach ($rows ?? [] as $r) {
            $out[$r->reaction] = (int) $r->n;
        }

        return $out;
    }

    private function preview(StatusUpdate $s): string
    {
        return $s->body ? Str::limit($s->body, 80) : 'Photo';
    }

    /** Pages showing statuses refresh at once (no content is sent, just "status N changed"). */
    private function changed(StatusUpdate $status): void
    {
        \App\Events\InstitutionBroadcast::dispatch($status->institution_id, 'status.changed', ['status_id' => $status->id]);
    }

    /** Tells people at once if they're online, and by push notification otherwise. */
    private function notify(array $userIds, string $kind, StatusUpdate $status, string $title, string $body, bool $push = true): void
    {
        foreach ($userIds as $id) {
            UserSignal::dispatch($id, $kind, ['status_id' => $status->id, 'title' => $title]);
        }
        if ($push) {
            SendPush::dispatchAfterResponse($userIds, $title, $body, ['type' => 'status', 'status_id' => $status->id, 'user_id' => $status->user_id]);
        }
    }

    private function contactIds(int $userId): array
    {
        return ConversationMember::whereIn('conversation_id', ConversationMember::where('user_id', $userId)
            ->whereHas('conversation', fn ($q) => $q->where('type', 'direct'))->select('conversation_id'))
            ->where('user_id', '!=', $userId)->pluck('user_id')->all();
    }
}
