<?php

namespace App\Services\Pages;

use App\Models\Page;
use App\Models\User;
use App\Support\Access;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Help pages and the design document. Each institution starts with the built-in versions (resources/help/*.md,
 * docs/design.md) and its admins can change, add, reorder or remove them. Markdown is turned into HTML on the
 * server with HTML input escaped and unsafe links blocked, so an edited page can never inject script.
 */
class PageLibrary
{
    public const AUDIENCES = ['everyone', 'students', 'staff', 'admins'];

    /** Built-in pages of a kind: [slug => [title, body, audience, position]]. */
    public static function defaults(string $kind): array
    {
        if ($kind === 'design') {
            $body = (string) @file_get_contents(base_path('docs/design.md'));

            return ['design' => ['title' => 'System design', 'body' => $body, 'audience' => 'admins', 'position' => 1]];
        }
        $out = [];
        foreach (glob(resource_path('help/*.md')) ?: [] as $i => $file) {
            $raw = (string) file_get_contents($file);
            $meta = [];
            if (preg_match('/^---\R(.*?)\R---\R/s', $raw, $m)) {
                foreach (preg_split('/\R/', $m[1]) as $line) {
                    if (str_contains($line, ':')) {
                        [$k, $v] = array_map('trim', explode(':', $line, 2));
                        $meta[$k] = $v;
                    }
                }
                $raw = substr($raw, strlen($m[0]));
            }
            $slug = Str::slug(preg_replace('/^\d+-/', '', basename($file, '.md')));
            $out[$slug] = ['title' => $meta['title'] ?? Str::headline($slug), 'body' => trim($raw), 'audience' => $meta['audience'] ?? 'everyone', 'position' => ($i + 1) * 10];
        }

        return $out;
    }

    /** Makes sure the institution has its copy of the built-in pages (the first time anyone opens them). */
    public function ensure(int $institutionId, string $kind): void
    {
        if (Page::where('kind', $kind)->exists()) {
            return;
        }
        foreach (self::defaults($kind) as $slug => $p) {
            Page::firstOrCreate(['institution_id' => $institutionId, 'kind' => $kind, 'slug' => $slug], $p);
        }
    }

    /** @return Collection<int, Page> pages of a kind this person may read */
    public function visible(User $me, string $kind): Collection
    {
        $this->ensure($me->institution_id, $kind);
        $admin = self::isAdmin($me);

        return Page::where('kind', $kind)->with('editor:id,name')->orderBy('position')->orderBy('title')->get()
            ->filter(fn (Page $p) => match ($p->audience) {
                'admins' => $admin,
                'students' => $admin || $me->member_type === 'student',
                'staff' => $admin || in_array($me->member_type, ['staff', 'admin'], true),
                default => true,
            })->values();
    }

    public static function isAdmin(User $me): bool
    {
        return Access::can($me, 'help.manage') || Access::can($me, 'design.view') || $me->member_type === 'admin';
    }

    /** Safe HTML, with ids on headings (for the contents list). */
    public static function render(string $markdown): array
    {
        $html = Str::markdown($markdown, ['html_input' => 'escape', 'allow_unsafe_links' => false]);
        $toc = [];
        $used = [];
        $html = preg_replace_callback('/<h([23])>(.*?)<\/h\1>/s', function ($m) use (&$toc, &$used) {
            $text = trim(html_entity_decode(strip_tags($m[2])));
            $id = Str::slug($text) ?: 'section';
            $base = $id;
            for ($n = 2; isset($used[$id]); $n++) {
                $id = "{$base}-{$n}";
            }
            $used[$id] = true;
            $toc[] = ['id' => $id, 'text' => $text, 'level' => (int) $m[1]];

            return "<h{$m[1]} id=\"{$id}\">{$m[2]}</h{$m[1]}>";
        }, $html);

        return ['html' => $html, 'toc' => $toc];
    }
}
