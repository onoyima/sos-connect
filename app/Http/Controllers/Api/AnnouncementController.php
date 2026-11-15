<?php

namespace App\Http\Controllers\Api;

use App\Events\InstitutionBroadcast;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Support\Access;
use App\Support\Audience;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The notices page. Everyone reads the notices meant for them; only people with "announcements.create"
 * can post, and only to the areas that permission covers (an HOD posts to their department, the Registrar
 * to everyone).
 */
class AnnouncementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        abort_unless(Access::can($me, 'announcements.view'), 403);
        $items = Announcement::with('author:id,name,title')->whereNotNull('published_at')->latest('published_at')->limit(200)->get()
            ->filter(fn ($a) => Audience::includes($a->audience, $me) || $a->author_id === $me->id)->take(50);

        return response()->json([
            'announcements' => $items->map(fn ($a) => $this->present($a, $me))->values(),
            'audiences' => Access::can($me, 'announcements.create') ? Audience::options($me, 'announcements.create') : [],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $this->validated($request);
        abort_unless(Audience::allowed($me, $data['audience'], 'announcements.create'), 403, 'You can only post notices to your own area.');

        $a = Announcement::create(['author_id' => $me->id, 'title' => $data['title'], 'body' => $data['body'],
            'priority' => $data['priority'] ?? 'normal', 'audience' => Audience::normalise($data['audience']), 'published_at' => now()]);
        AuditLog::record('announcement.published', $a, ['audience' => Audience::describe($a->audience)]);

        InstitutionBroadcast::dispatch($me->institution_id, 'announcement.published', ['id' => $a->id, 'title' => $a->title, 'audience' => $a->audience]);
        $me->colleagues()->select('id', 'institution_id', 'member_type', 'faculty_unit_id', 'department_unit_id', 'admin_unit_id')
            ->chunkById(1000, function ($users) use ($a) {
                $ids = $users->filter(fn ($u) => Audience::includes($a->audience, $u))->pluck('id')->all();
                SendPush::dispatch($ids, $a->title, mb_substr($a->body, 0, 120), ['type' => 'announcement', 'id' => $a->id], $a->priority === 'urgent');
            });

        return response()->json(['id' => $a->id], 201);
    }

    public function update(Request $request, Announcement $announcement): JsonResponse
    {
        $me = $request->user();
        $data = $this->validated($request);
        $mine = $announcement->author_id === $me->id && Audience::allowed($me, $announcement->audience, 'announcements.create');
        abort_unless($mine || Audience::allowed($me, $announcement->audience, 'announcements.edit'), 403);
        abort_unless(Audience::allowed($me, $data['audience'], $mine ? 'announcements.create' : 'announcements.edit'), 403, 'You can only post notices to your own area.');

        $announcement->update(['title' => $data['title'], 'body' => $data['body'], 'priority' => $data['priority'] ?? $announcement->priority,
            'audience' => Audience::normalise($data['audience'])]);
        AuditLog::record('announcement.edited', $announcement);

        return response()->json(['announcement' => $this->present($announcement->fresh('author'), $me)]);
    }

    public function destroy(Request $request, Announcement $announcement): JsonResponse
    {
        $me = $request->user();
        abort_unless($announcement->author_id === $me->id || Audience::allowed($me, $announcement->audience, 'announcements.delete'), 403);
        $announcement->delete();
        AuditLog::record('announcement.deleted', $announcement, ['title' => $announcement->title]);

        return response()->json(['ok' => true]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'title' => 'required|string|max:160', 'body' => 'required|string|max:5000', 'priority' => 'nullable|in:normal,urgent',
            'audience' => 'required|array', 'audience.type' => 'required|in:all,staff,students,parents,unit,department,faculty',
            'audience.id' => 'nullable|integer', 'audience.who' => 'nullable|in:all,students,staff',
        ]);
    }

    private function present(Announcement $a, $me): array
    {
        $canEdit = $a->author_id === $me->id || Audience::allowed($me, $a->audience, 'announcements.edit');

        return [
            'id' => $a->id, 'title' => $a->title, 'body' => $a->body, 'priority' => $a->priority,
            'audience' => $a->audience, 'audience_label' => Audience::describe($a->audience),
            'author' => $a->author ? ['name' => $a->author->name, 'title' => $a->author->title] : null,
            'published_at' => $a->published_at?->toIso8601String(),
            'can_edit' => $canEdit,
            'can_delete' => $a->author_id === $me->id || Audience::allowed($me, $a->audience, 'announcements.delete'),
        ];
    }
}
