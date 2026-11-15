<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FaceCapture;
use App\Models\FaceEnrollment;
use App\Models\User;
use App\Services\Faces\FaceStore;
use App\Support\CurrentInstitution;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * A person capturing their own face. The website uses the signed-in session; the phone app opens the same
 * capture page in a web view with a short-lived ticket (/api/face/t/{ticket}/...), since the camera steps run there.
 */
class FaceController extends Controller
{
    private const TICKET_MINUTES = 30;

    public function __construct(private readonly FaceStore $faces)
    {
    }

    public function show(Request $request): JsonResponse
    {
        $me = $this->who($request);

        return response()->json(self::state($me));
    }

    /** What the capture page and the phone need to know about this person. */
    public static function state(User $me): array
    {
        $current = FaceStore::current($me);

        return [
            'enabled' => Modules::enabled($me->institution, 'face_capture'),
            'required' => Modules::enabled($me->institution, 'face_capture_required'),
            'blocked' => FaceStore::blockedReason($me),
            'consent_text' => FaceStore::consentText($me->institution?->name ?? 'Your institution'),
            'poses' => FaceStore::POSES,
            'current' => $current ? [
                'completed_at' => $current->completed_at?->toIso8601String(),
                'quality' => $current->quality,
                'captures' => $current->captures()->orderBy('id')->get(['id', 'pose'])->map(fn ($c) => ['id' => $c->id, 'pose' => $c->pose])->values(),
            ] : null,
        ];
    }

    public function start(Request $request): JsonResponse
    {
        $me = $this->who($request);
        $request->validate(['consent' => 'accepted']);
        abort_if($why = FaceStore::blockedReason($me), 403, $why ?? '');
        $e = $this->faces->start($me, $request->route('ticket') ? 'phone' : 'web', $request->ip(), $request->userAgent());

        return response()->json(['uuid' => $e->uuid, 'poses' => FaceStore::POSES], 201);
    }

    public function capture(Request $request): JsonResponse
    {
        $me = $this->who($request);
        $data = $request->validate([
            'pose' => 'required|string|in:'.implode(',', array_keys(FaceStore::POSES)),
            'image' => 'required|file|max:4096',
            'metrics' => 'nullable|string|max:4000',
            'landmarks' => 'nullable|string|max:120000',
        ]);
        $enrollment = $this->enrollment($me, (string) $request->route('uuid'));
        $metrics = json_decode((string) ($data['metrics'] ?? '[]'), true) ?: [];
        $landmarks = isset($data['landmarks']) ? (json_decode($data['landmarks'], true) ?: null) : null;
        $c = $this->faces->addCapture($enrollment, $data['pose'], $request->file('image'), is_array($metrics) ? $metrics : [], is_array($landmarks) ? $landmarks : null);

        return response()->json(['id' => $c->id, 'pose' => $c->pose, 'width' => $c->width, 'height' => $c->height, 'quality' => $this->faces->qualityOf($c)], 201);
    }

    public function complete(Request $request): JsonResponse
    {
        $me = $this->who($request);
        $data = $request->validate([
            'liveness' => 'required|array',
            'liveness.blinks' => 'required|integer|min:0|max:20',
            'liveness.mouth' => 'required|boolean',
            'liveness.turns' => 'required|boolean',
            'liveness.nods' => 'nullable|boolean',
            'liveness.seconds' => 'nullable|integer|min:0|max:3600',
        ]);
        $e = $this->faces->complete($this->enrollment($me, (string) $request->route('uuid')), $data['liveness']);

        return response()->json(['ok' => true, 'quality' => $e->quality, 'completed_at' => $e->completed_at?->toIso8601String()]);
    }

    /** One of my own photos (so I can see what was saved). */
    public function image(Request $request): Response
    {
        $me = $this->who($request);
        $c = FaceCapture::where('user_id', $me->id)->findOrFail((int) $request->route('id'));

        return response($this->faces->image($c), 200, ['Content-Type' => 'image/jpeg', 'Cache-Control' => 'no-store, private']);
    }

    /** "Delete my face data". */
    public function destroy(Request $request): JsonResponse
    {
        $me = $this->who($request);
        $this->faces->forget($me);
        \App\Models\AuditLog::record('face.deleted_by_owner', $me);

        return response()->json(['ok' => true]);
    }

    /** The phone app opens the capture page with this (the camera steps run in its web view). */
    public function ticket(Request $request): JsonResponse
    {
        $me = $request->user();
        abort_if($why = FaceStore::blockedReason($me), 403, $why ?? '');
        $token = Str::random(48);
        Cache::put('face-ticket:'.hash('sha256', $token), $me->id, now()->addMinutes(self::TICKET_MINUTES));

        return response()->json(['url' => url("/face/app/{$token}"), 'expires_in' => self::TICKET_MINUTES * 60]);
    }

    /** The person capturing: the signed-in member, or the holder of a phone ticket. */
    private function who(Request $request): User
    {
        $ticket = $request->route('ticket');
        if (! $ticket) {
            return $request->user();
        }
        $me = self::ticketUser((string) $ticket);
        abort_unless($me, 401, 'This capture link has expired. Go back and open face capture again.');

        return $me;
    }

    public static function ticketUser(string $ticket): ?User
    {
        $id = Cache::get('face-ticket:'.hash('sha256', $ticket));
        $me = $id ? User::find($id) : null;
        if (! $me || ! $me->isActive() || ! $me->institution?->isActive()) {
            return null;
        }
        CurrentInstitution::set($me->institution_id);

        return $me;
    }

    private function enrollment(User $me, string $uuid): FaceEnrollment
    {
        return FaceEnrollment::where('user_id', $me->id)->where('uuid', $uuid)->firstOrFail();
    }
}
