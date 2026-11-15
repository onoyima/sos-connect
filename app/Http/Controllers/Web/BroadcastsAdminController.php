<?php

namespace App\Http\Controllers\Web;

use App\Events\InstitutionBroadcast;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Broadcast;
use App\Support\Access;
use App\Support\Audience;
use App\Support\Modules;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Admin > Pop-ups and marquee. People with "broadcasts.manage" write a pop-up (shown every time the app is opened,
 * until they pause it) or a marquee line (slides across the top of every screen), for an audience they look after.
 */
class BroadcastsAdminController extends Controller
{
    public function index(Request $request): Response
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'broadcasts'), 404);

        return Inertia::render('Admin/Broadcasts', [
            'items' => Broadcast::with('creator:id,name')->latest()->limit(100)->get()->map(fn (Broadcast $b) => [
                'id' => $b->id, 'kind' => $b->kind, 'style' => $b->style, 'title' => $b->title, 'body' => $b->body,
                'link_url' => $b->link_url, 'link_label' => $b->link_label, 'audience' => $b->audience,
                'audience_label' => Audience::describe($b->audience ?? ['type' => 'all']), 'state' => $b->state(),
                'starts_at' => $b->starts_at?->toIso8601String(), 'ends_at' => $b->ends_at?->toIso8601String(),
                'by' => $b->creator?->name, 'created_at' => $b->created_at?->toIso8601String(),
                'can_edit' => Audience::allowed($me, $b->audience ?? ['type' => 'all'], 'broadcasts.manage'),
            ]),
            'audiences' => Audience::options($me, 'broadcasts.manage'),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $me = $request->user();
        $data = $this->validated($request);
        abort_unless(Audience::allowed($me, $data['audience'], 'broadcasts.manage'), 403, 'You can only send to the areas you look after.');
        $b = Broadcast::create($data + ['created_by' => $me->id]);
        AuditLog::record('broadcast.created', $b, ['kind' => $b->kind, 'audience' => Audience::describe($b->audience)]);
        $this->changed($b);

        return back()->with('status', $b->kind === 'popup' ? 'Pop-up is live. People see it every time they open the app until you pause it.' : 'Marquee is live.');
    }

    public function update(Request $request, Broadcast $broadcast): RedirectResponse
    {
        $me = $request->user();
        $this->mayEdit($me, $broadcast);
        $data = $this->validated($request);
        abort_unless(Audience::allowed($me, $data['audience'], 'broadcasts.manage'), 403, 'You can only send to the areas you look after.');
        $broadcast->update($data);
        AuditLog::record('broadcast.updated', $broadcast);
        $this->changed($broadcast);

        return back()->with('status', 'Saved.');
    }

    public function pause(Request $request, Broadcast $broadcast): RedirectResponse
    {
        $this->mayEdit($request->user(), $broadcast);
        $paused = $broadcast->paused_at === null;
        $broadcast->update(['paused_at' => $paused ? now() : null]);
        AuditLog::record($paused ? 'broadcast.paused' : 'broadcast.resumed', $broadcast);
        $this->changed($broadcast);

        return back()->with('status', $paused ? 'Paused. Nobody sees it until you resume it.' : 'Running again.');
    }

    public function destroy(Request $request, Broadcast $broadcast): RedirectResponse
    {
        $this->mayEdit($request->user(), $broadcast);
        $broadcast->delete();
        AuditLog::record('broadcast.deleted', $broadcast);
        $this->changed($broadcast);

        return back()->with('status', 'Deleted.');
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'kind' => 'required|in:popup,marquee',
            'style' => 'required|in:info,urgent,celebration',
            'title' => 'nullable|string|max:160',
            'body' => 'required|string|max:'.($request->input('kind') === 'marquee' ? 300 : 2000),
            'link_url' => ['nullable', 'string', 'max:300', 'regex:#^(https://|/)#'],
            'link_label' => 'nullable|string|max:60',
            'audience' => 'required|array',
            // Every key needs a rule, or Laravel drops it from the checked array.
            'audience.type' => 'required|string',
            'audience.id' => 'nullable|integer',
            'audience.who' => 'nullable|string|in:all,students,staff',
            'audience.level' => 'nullable|integer|min:100|max:900',
            'starts_at' => 'nullable|date',
            'ends_at' => 'nullable|date|after:starts_at',
        ]);
        $data['audience'] = Audience::normalise($data['audience']);

        return $data;
    }

    private function mayEdit($me, Broadcast $b): void
    {
        abort_unless(Audience::allowed($me, $b->audience ?? ['type' => 'all'], 'broadcasts.manage'), 403, 'This was sent to an area you don\'t look after.');
    }

    private function changed(Broadcast $b): void
    {
        InstitutionBroadcast::dispatch($b->institution_id, 'broadcast.changed', ['id' => $b->id]);
    }
}
