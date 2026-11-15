<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Institution;
use App\Support\Branding;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/** Admin > Look and icons: favicon, chat icon, and the automatic seasonal touch. */
class BrandingController extends Controller
{
    private const TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/x-icon' => 'ico', 'image/vnd.microsoft.icon' => 'ico'];

    public function index(Request $request): Response
    {
        $i = $request->user()->institution;
        $today = CarbonImmutable::now();
        // The next date each celebration shows, so the admin can see what to expect.
        $upcoming = [];
        for ($d = 0; $d < 400 && count($upcoming) < count(Branding::SEASONS); $d++) {
            $s = Branding::seasonOn($today->addDays($d), $i->country ?? 'NG');
            if ($s && ! isset($upcoming[$s['key']])) {
                $upcoming[$s['key']] = $today->addDays($d)->toDateString();
            }
        }

        return Inertia::render('Admin/Branding', [
            'settings' => Branding::settings($i),
            'current' => Branding::forClient($i),
            'seasons' => collect(Branding::SEASONS)->map(fn ($s, $k) => $s + ['key' => $k, 'next' => $upcoming[$k] ?? null])->values(),
        ]);
    }

    public function save(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $data = $request->validate([
            'favicon' => 'nullable|file|max:512',
            'icon' => 'nullable|file|max:2048',
            'remove' => 'nullable|in:favicon,icon',
            'seasonal' => 'nullable|boolean',
            'seasons' => 'nullable|array', 'seasons.*' => 'in:'.implode(',', array_keys(Branding::SEASONS)),
        ]);
        $b = ($i->settings ?? [])['branding'] ?? [];
        foreach (['favicon', 'icon'] as $kind) {
            if ($file = $request->file($kind)) {
                $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath()); // from the bytes, never the name
                abort_unless(isset(self::TYPES[$mime]), 422, 'Use a PNG, JPG, WebP or ICO image.');
                if ($kind === 'icon') {
                    [$w, $h] = @getimagesize($file->getRealPath()) ?: [0, 0];
                    abort_if($w < 96 || $h < 96, 422, 'The chat icon should be at least 96×96 pixels (square works best).');
                }
                if (! empty($b[$kind])) {
                    Storage::disk('local')->delete($b[$kind]);
                }
                $path = "branding/{$i->id}/{$kind}.".self::TYPES[$mime];
                Storage::disk('local')->put($path, file_get_contents($file->getRealPath()));
                $b[$kind] = $path;
            }
        }
        if (! empty($data['remove']) && ! empty($b[$data['remove']])) {
            Storage::disk('local')->delete($b[$data['remove']]);
            $b[$data['remove']] = null;
        }
        if ($request->has('seasonal')) {
            $b['seasonal'] = (bool) $data['seasonal'];
        }
        if ($request->has('seasons')) {
            $b['seasons'] = array_values($data['seasons'] ?? []);
        }
        $b['version'] = (string) time();
        $i->update(['settings' => array_merge($i->settings ?? [], ['branding' => $b])]);
        AuditLog::record('branding.changed', $i);

        return back()->with('status', 'Saved. Everyone sees the change the next time a page opens.');
    }

    /** The favicon or chat icon (public: the sign-in page and the browser tab need it). */
    public function file(int $institution, string $kind): HttpResponse
    {
        abort_unless(in_array($kind, ['favicon', 'icon'], true), 404);
        $i = Institution::find($institution);
        $path = $i ? (Branding::settings($i)[$kind] ?? null) : null;
        abort_unless($path && Storage::disk('local')->exists($path), 404);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes = Storage::disk('local')->get($path));

        return response($bytes, 200, ['Content-Type' => $mime, 'Cache-Control' => 'public, max-age=604800', 'X-Content-Type-Options' => 'nosniff']);
    }
}
