<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Page;
use App\Services\Pages\PageLibrary;
use App\Support\Access;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** Help (everyone) and the design document (admins), both editable by people with "help.manage". */
class PagesController extends Controller
{
    public function __construct(private readonly PageLibrary $pages)
    {
    }

    public function help(Request $request, ?string $slug = null): Response
    {
        $me = $request->user();
        $list = $this->pages->visible($me, 'help');
        $page = $slug ? $list->firstWhere('slug', $slug) : $list->first();
        abort_if($slug && ! $page, 404);

        return Inertia::render('Help/Index', [
            'pages' => $list->map(fn (Page $p) => ['slug' => $p->slug, 'title' => $p->title, 'audience' => $p->audience])->values(),
            'page' => $page ? $this->present($page, $me) : null,
            'can_edit' => Access::can($me, 'help.manage'),
            'audiences' => PageLibrary::AUDIENCES,
        ]);
    }

    public function design(Request $request): Response
    {
        $me = $request->user();
        $page = $this->pages->visible($me, 'design')->first();
        abort_unless($page, 404);

        return Inertia::render('Admin/Design', ['page' => $this->present($page, $me), 'can_edit' => Access::can($me, 'help.manage')]);
    }

    /** Create or change a page. */
    public function save(Request $request, string $kind, ?string $slug = null): RedirectResponse
    {
        abort_unless(in_array($kind, ['help', 'design'], true), 404);
        $me = $request->user();
        $data = $request->validate([
            'title' => 'required|string|max:160',
            'body' => 'required|string|max:200000',
            'audience' => ['required', Rule::in(PageLibrary::AUDIENCES)],
            'position' => 'nullable|integer|min:0|max:9999',
        ]);
        $this->pages->ensure($me->institution_id, $kind);
        $page = $slug ? Page::where('kind', $kind)->where('slug', $slug)->firstOrFail() : new Page(['kind' => $kind]);
        if (! $page->exists) {
            $base = Str::slug($data['title']) ?: 'page';
            $new = $base;
            for ($n = 2; Page::where('kind', $kind)->where('slug', $new)->exists(); $n++) {
                $new = "{$base}-{$n}";
            }
            $page->slug = $new;
            $page->position = $data['position'] ?? ((int) Page::where('kind', $kind)->max('position') + 10);
        }
        $page->fill(['title' => $data['title'], 'body' => $data['body'], 'audience' => $kind === 'design' ? 'admins' : $data['audience'],
            'updated_by' => $me->id] + (isset($data['position']) ? ['position' => $data['position']] : []));
        $page->save();
        AuditLog::record($page->wasRecentlyCreated ? 'page.created' : 'page.updated', $page, ['kind' => $kind, 'title' => $page->title]);

        return redirect($kind === 'design' ? '/admin/design' : "/help/{$page->slug}")->with('status', 'Saved.');
    }

    public function destroy(Request $request, string $slug): RedirectResponse
    {
        $page = Page::where('kind', 'help')->where('slug', $slug)->firstOrFail();
        $page->delete();
        AuditLog::record('page.deleted', $page, ['title' => $page->title]);

        return redirect('/help')->with('status', 'Page removed.');
    }

    /** Put a built-in page back to how it came. */
    public function reset(Request $request, string $kind, string $slug): RedirectResponse
    {
        $default = PageLibrary::defaults($kind)[$slug] ?? abort(404, 'This page has no built-in version.');
        Page::where('kind', $kind)->where('slug', $slug)->firstOrFail()->update($default + ['updated_by' => $request->user()->id]);
        AuditLog::record('page.reset', null, ['kind' => $kind, 'slug' => $slug]);

        return back()->with('status', 'Restored the original version.');
    }

    public function preview(Request $request): JsonResponse
    {
        return response()->json(PageLibrary::render((string) $request->validate(['body' => 'nullable|string|max:200000'])['body']));
    }

    private function present(Page $p, $me): array
    {
        $r = PageLibrary::render($p->body);
        $p->loadMissing('editor:id,name');

        return [
            'slug' => $p->slug, 'title' => $p->title, 'audience' => $p->audience, 'position' => $p->position,
            'html' => $r['html'], 'toc' => $r['toc'],
            'body' => Access::can($me, 'help.manage') ? $p->body : null,
            'updated_at' => $p->updated_at?->toIso8601String(), 'editor' => $p->editor?->name,
            'built_in' => isset(PageLibrary::defaults($p->kind)[$p->slug]),
        ];
    }
}
