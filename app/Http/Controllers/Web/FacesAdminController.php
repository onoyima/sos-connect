<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Jobs\RunFaceExport;
use App\Models\AuditLog;
use App\Models\FaceCapture;
use App\Models\FaceEnrollment;
use App\Models\FaceExport;
use App\Models\InstitutionConnector;
use App\Models\User;
use App\Services\Faces\FaceExporter;
use App\Services\Faces\FaceStore;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin > Face capture: who has captured their face, each person's photos, and sending them to the school's
 * systems (encrypted file, or straight into the school's database). Every view of a photo and every export is audited.
 */
class FacesAdminController extends Controller
{
    private const TYPES = ['student', 'staff'];

    public function index(Request $request): Response
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'face_capture'), 404);
        $base = $this->people($me);

        $done = FaceEnrollment::where('status', 'complete')->select('user_id');
        $q = (clone $base)->with(['department', 'adminUnit'])->orderBy('name');
        match ($request->query('status')) {
            'done' => $q->whereIn('id', $done),
            'missing' => $q->whereNotIn('id', $done),
            'not_sent' => $q->whereIn('id', FaceEnrollment::where('status', 'complete')->whereNull('exported_file_at')->whereNull('exported_db_at')->select('user_id')),
            default => null,
        };
        if ($s = trim((string) $request->query('q'))) {
            $q->where(fn ($w) => $w->where('name', 'like', '%'.addcslashes(mb_substr((string) $s, 0, 80), '%_\\').'%')->orWhere('identifier', $s));
        }
        if (in_array($type = $request->query('type'), self::TYPES, true)) {
            $q->where('member_type', $type);
        }
        $page = $q->paginate(30)->withQueryString();
        $enrollments = FaceEnrollment::where('status', 'complete')->whereIn('user_id', collect($page->items())->pluck('id'))
            ->with(['captures' => fn ($c) => $c->where('pose', 'front_final')->select('id', 'face_enrollment_id', 'pose')])->get()->keyBy('user_id');

        $total = (clone $base)->count();
        $complete = (clone $base)->whereIn('id', $done)->count();
        $connector = InstitutionConnector::where('institution_id', $me->institution_id)->first();
        $target = $connector?->face_db_settings ?? [];
        $records = $connector?->db_settings ?? [];

        return Inertia::render('Admin/Faces', [
            'people' => $page->through(function (User $u) use ($enrollments) {
                $e = $enrollments[$u->id] ?? null;

                return [
                    'id' => $u->id, 'name' => $u->name, 'identifier' => $u->identifier, 'member_type' => $u->member_type,
                    'department' => $u->department?->name ?? $u->adminUnit?->name, 'is_minor' => (bool) $u->is_minor,
                    'face' => $e ? [
                        'completed_at' => $e->completed_at?->toIso8601String(), 'quality' => $e->quality, 'device' => $e->device,
                        'sent_file' => (bool) $e->exported_file_at, 'sent_db' => (bool) $e->exported_db_at,
                        'thumb' => ($c = $e->captures->first()) ? "/admin/faces/image/{$c->id}" : null,
                    ] : null,
                ];
            }),
            'stats' => [
                'total' => $total, 'complete' => $complete, 'missing' => max(0, $total - $complete),
                'not_sent' => FaceEnrollment::where('status', 'complete')->whereNull('exported_file_at')->whereNull('exported_db_at')->count(),
                'required' => Modules::enabled($me->institution, 'face_capture_required'),
            ],
            'exports' => FaceExport::with('creator:id,name')->latest()->limit(8)->get()->map(fn (FaceExport $x) => [
                'id' => $x->id, 'kind' => $x->kind, 'scope' => $x->scope, 'status' => $x->status, 'people' => $x->people, 'images' => $x->images,
                'error' => $x->error, 'by' => $x->creator?->name, 'at' => $x->created_at?->toIso8601String(),
                'download' => $x->kind === 'file' && $x->status === 'done' && $x->path && Storage::disk('local')->exists($x->path) ? "/admin/faces/exports/{$x->id}/download" : null,
            ]),
            'target' => [
                'driver' => $target['driver'] ?? ($records['driver'] ?? 'mysql'),
                'host' => $target['host'] ?? ($records['host'] ?? ''),
                'port' => $target['port'] ?? ($records['port'] ?? 3306),
                'database' => $target['database'] ?? ($records['database'] ?? ''),
                'username' => $target['username'] ?? '',
                'prefix' => $target['prefix'] ?? 'sos_',
                'has_password' => ! empty($target['password']),
                'saved' => ! empty($target['database']),
            ],
            'filters' => $request->only(['q', 'status', 'type']),
            'can' => ['export' => Access::can($me, 'faces.export')],
        ]);
    }

    /** One person's photos (for the review panel). */
    public function person(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $user = User::inInstitution($me->institution_id)->findOrFail($id);
        abort_unless(Access::canOnUser($me, 'faces.view', $user), 403);
        $e = FaceStore::current($user);
        AuditLog::record('face.viewed', $user);

        return response()->json([
            'name' => $user->name, 'identifier' => $user->identifier,
            'face' => $e ? [
                'completed_at' => $e->completed_at?->toIso8601String(), 'quality' => $e->quality, 'liveness' => $e->liveness, 'device' => $e->device,
                'consent_at' => $e->consent_at?->toIso8601String(), 'sent_file_at' => $e->exported_file_at?->toIso8601String(), 'sent_db_at' => $e->exported_db_at?->toIso8601String(),
                'captures' => $e->captures()->get()->sortBy(fn ($c) => array_search($c->pose, array_keys(FaceStore::POSES), true))->values()->map(fn (FaceCapture $c) => [
                    'id' => $c->id, 'pose' => $c->pose, 'label' => FaceStore::POSES[$c->pose] ?? $c->pose, 'url' => "/admin/faces/image/{$c->id}",
                    'width' => $c->width, 'height' => $c->height, 'metrics' => $c->metrics, 'quality' => app(FaceStore::class)->qualityOf($c),
                ]),
            ] : null,
        ]);
    }

    public function image(Request $request, int $id, FaceStore $faces): HttpResponse
    {
        $me = $request->user();
        $c = FaceCapture::findOrFail($id);
        $user = User::findOrFail($c->user_id);
        abort_unless(Access::canOnUser($me, 'faces.view', $user), 403);

        return response($faces->image($c), 200, ['Content-Type' => 'image/jpeg', 'Cache-Control' => 'no-store, private']);
    }

    /** Removes a person's face data (e.g. they asked the institution to delete it). */
    public function forget(Request $request, int $id, FaceStore $faces): RedirectResponse
    {
        $me = $request->user();
        $user = User::inInstitution($me->institution_id)->findOrFail($id);
        abort_unless(Access::can($me, 'faces.export') && Access::canOnUser($me, 'faces.view', $user), 403);
        $faces->forget($user);
        AuditLog::record('face.deleted_by_admin', $user);

        return back()->with('status', "{$user->name}'s face photos were deleted here. Copies already sent to the school's systems are not affected.");
    }

    public function saveTarget(Request $request): RedirectResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'driver' => 'required|in:mysql,mariadb',
            'host' => 'required|string|max:190',
            'port' => 'required|integer|min:1|max:65535',
            'database' => 'required|string|max:120',
            'username' => 'required|string|max:120',
            'password' => 'nullable|string|max:190',
            'prefix' => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9_]*$/'],
        ]);
        $connector = InstitutionConnector::firstOrNew(['institution_id' => $me->institution_id]);
        $old = $connector->face_db_settings ?? [];
        $data['password'] = ($data['password'] ?? '') !== '' ? $data['password'] : ($old['password'] ?? null);
        $data['prefix'] = $data['prefix'] ?? 'sos_';
        try {
            $message = app(FaceExporter::class)->test($data);
        } catch (\Throwable $e) {
            return back()->withErrors(['target' => app(FaceExporter::class)->explain($e)]);
        }
        if (! $connector->exists) {
            // No records connection yet: keep the row valid for the sign-in settings page.
            $connector->forceFill(['base_url' => 'direct', 'key_id' => '', 'secret' => '']);
        }
        $connector->face_db_settings = $data;
        $connector->save();
        AuditLog::record('face.target_saved', null, ['host' => $data['host'], 'database' => $data['database']]);

        return back()->with('status', $message);
    }

    public function export(Request $request): RedirectResponse
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'face_capture'), 404);
        $data = $request->validate([
            'kind' => 'required|in:file,database',
            'scope' => 'required|in:new,all',
            'password' => 'required_if:kind,file|nullable|string|min:8|max:100|confirmed',
        ]);
        // Area admins can see faces in their area; sending them out is for the whole institution only.
        abort_unless(Access::canEverywhere($me, 'faces.view'), 403, 'Sending faces out needs "See captured faces" for the whole institution.');
        if (FaceExport::whereIn('status', ['queued', 'running'])->where('created_at', '>', now()->subHour())->exists()) {
            return back()->withErrors(['export' => 'Another export is still running. Wait for it to finish.']);
        }

        $x = FaceExport::create(['created_by' => $me->id, 'kind' => $data['kind'], 'scope' => $data['scope'], 'status' => 'queued']);
        AuditLog::record('face.export_started', $x, ['kind' => $x->kind, 'scope' => $x->scope]);
        RunFaceExport::dispatch($x->id, $me->institution_id, $data['kind'] === 'file' ? $data['password'] : null);

        $x->refresh();
        if ($x->status === 'failed') {
            return back()->withErrors(['export' => $x->error]);
        }

        return back()->with('status', $x->status === 'done'
            ? ($x->kind === 'file' ? "Export ready: {$x->people} people, {$x->images} photos. Download it below; it is removed after a day." : "Sent {$x->people} people ({$x->images} photos) to the school database.")
            : 'Export started. This page shows when it is ready.');
    }

    public function download(Request $request, int $id): StreamedResponse
    {
        $x = FaceExport::where('kind', 'file')->where('status', 'done')->findOrFail($id);
        abort_unless($x->path && Storage::disk('local')->exists($x->path), 410, 'This file was removed. Make a new export.');
        AuditLog::record('face.export_downloaded', $x);

        return Storage::disk('local')->download($x->path, basename($x->path), ['Cache-Control' => 'no-store, private']);
    }

    /** Students and staff in the admin's area. */
    private function people(User $me)
    {
        $units = Access::units($me, 'faces.view');
        $q = User::inInstitution($me->institution_id)->where('status', 'active')->whereIn('member_type', self::TYPES);
        if ($units !== null) {
            $q->where(fn ($w) => $w->whereIn('department_unit_id', $units ?: [0])->orWhereIn('faculty_unit_id', $units ?: [0])->orWhereIn('admin_unit_id', $units ?: [0]));
        }

        return $q;
    }
}
