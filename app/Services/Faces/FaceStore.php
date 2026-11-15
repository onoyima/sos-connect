<?php

namespace App\Services\Faces;

use App\Models\AuditLog;
use App\Models\Consent;
use App\Models\FaceCapture;
use App\Models\FaceEnrollment;
use App\Models\User;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Keeps face captures. Every photo is encrypted on disk with the app key, only its owner and admins with
 * "faces.view" over that person can see it, and a new finished capture replaces the previous one.
 */
class FaceStore
{
    /** The photos a finished capture must have, in the order people are asked for them. */
    public const POSES = [
        'front' => 'Looking straight at the camera',
        'left' => 'Head turned to their left',
        'right' => 'Head turned to their right',
        'up' => 'Looking up',
        'down' => 'Looking down',
        'mouth' => 'Mouth open',
        'front_final' => 'Looking straight again (final photo)',
    ];

    public const CONSENT_KIND = 'face_capture';

    public const CONSENT_VERSION = '2026-11';

    /** What people agree to before the camera starts. */
    public static function consentText(string $institution): string
    {
        return "{$institution} will keep photos of your face, taken from several angles, together with your name and ID number. "
            .'They are stored encrypted and can be sent to the school\'s own systems, which may use them to recognise you '
            .'(for example at exams, gates or when you need to prove who you are). You can ask for them to be deleted here at any time; '
            .'copies already sent to the school are handled by the school under its data protection policy.';
    }

    /** May this person capture their face now? Returns null, or the reason they can't. */
    public static function blockedReason(User $user): ?string
    {
        if (! Modules::enabled($user->institution, 'face_capture')) {
            return 'Face capture is not switched on for your institution.';
        }
        if ($user->is_minor && ! $user->guardian_consent_at && ! $user->institution?->setting('minor_consent_at_admission')) {
            return 'You are under 18, so your institution has to record your parent or guardian\'s consent before your face can be captured.';
        }
        if (! Access::can($user, 'face.capture')) {
            return 'Face capture is not on for your account.';
        }

        return null;
    }

    public static function current(User $user): ?FaceEnrollment
    {
        return FaceEnrollment::where('user_id', $user->id)->where('status', 'complete')->latest('completed_at')->first();
    }

    public function start(User $user, string $device, ?string $ip, ?string $agent): FaceEnrollment
    {
        // An unfinished earlier attempt is thrown away.
        FaceEnrollment::where('user_id', $user->id)->where('status', 'in_progress')->get()->each(fn ($e) => $this->deleteEnrollment($e));

        Consent::create(['user_id' => $user->id, 'kind' => self::CONSENT_KIND, 'version' => self::CONSENT_VERSION, 'granted' => true,
            'ip_address' => $ip, 'user_agent' => Str::limit((string) $agent, 250, '')]);

        return FaceEnrollment::create([
            'user_id' => $user->id, 'uuid' => (string) Str::uuid(), 'status' => 'in_progress', 'device' => $device === 'phone' ? 'phone' : 'web',
            'consent_version' => self::CONSENT_VERSION, 'consent_at' => now(),
        ]);
    }

    /** Saves one photo (replacing an earlier one of the same pose in this capture). */
    public function addCapture(FaceEnrollment $enrollment, string $pose, UploadedFile $file, array $metrics, ?array $landmarks): FaceCapture
    {
        abort_unless(isset(self::POSES[$pose]), 422, 'Unknown pose.');
        abort_unless($enrollment->status === 'in_progress', 409, 'This capture is already finished. Start a new one.');

        $bytes = (string) file_get_contents($file->getRealPath());
        $info = @getimagesizefromstring($bytes);
        abort_unless($info && $info[2] === IMAGETYPE_JPEG, 422, 'The photo must be a JPEG image.');
        [$w, $h] = $info;
        abort_if($w < 240 || $h < 300, 422, 'The photo is too small. Move closer to the camera.');

        $path = "faces/{$enrollment->institution_id}/{$enrollment->user_id}/{$enrollment->uuid}-{$pose}.enc";
        Storage::disk('local')->put($path, Crypt::encryptString($bytes));

        $clean = [];
        foreach (['yaw', 'pitch', 'roll', 'sharpness', 'brightness', 'face_width', 'face_ratio', 'eyes_closed', 'mouth_open', 'frame_width', 'frame_height'] as $k) {
            if (isset($metrics[$k]) && is_numeric($metrics[$k])) {
                $clean[$k] = round((float) $metrics[$k], 3);
            }
        }

        $old = FaceCapture::where('face_enrollment_id', $enrollment->id)->where('pose', $pose)->first();
        if ($old && $old->path !== $path) {
            Storage::disk('local')->delete($old->path);
        }

        return FaceCapture::updateOrCreate(['face_enrollment_id' => $enrollment->id, 'pose' => $pose], [
            'user_id' => $enrollment->user_id, 'path' => $path, 'mime' => 'image/jpeg', 'width' => $w, 'height' => $h,
            'bytes' => strlen($bytes), 'sha256' => hash('sha256', $bytes), 'metrics' => $clean,
            'landmarks' => $landmarks ? json_encode($this->roundLandmarks($landmarks)) : null,
        ]);
    }

    /** Finishes a capture: every pose present and the liveness checks passed. The previous capture is removed. */
    public function complete(FaceEnrollment $enrollment, array $liveness): FaceEnrollment
    {
        abort_unless($enrollment->status === 'in_progress', 409, 'This capture is already finished.');
        $have = $enrollment->captures()->pluck('pose')->all();
        $missing = array_diff(array_keys(self::POSES), $have);
        abort_if($missing, 422, 'Some photos are missing: '.implode(', ', $missing).'. Please finish all the steps.');
        abort_if(((int) ($liveness['blinks'] ?? 0)) < 2 || empty($liveness['mouth']) || empty($liveness['turns']), 422,
            'The live checks (blink twice, open your mouth, turn your head) were not completed.');

        $captures = $enrollment->captures()->get();
        $quality = round($captures->avg(fn (FaceCapture $c) => $this->qualityOf($c)), 2);

        DB::transaction(function () use ($enrollment, $liveness, $quality) {
            $previous = FaceEnrollment::where('user_id', $enrollment->user_id)->where('status', 'complete')->get();
            foreach ($previous as $p) {
                $this->deleteFiles($p);
                $p->update(['status' => 'superseded']);
            }
            $enrollment->update([
                'status' => 'complete', 'completed_at' => now(), 'quality' => $quality,
                'liveness' => [
                    'blinks' => (int) $liveness['blinks'], 'mouth' => (bool) $liveness['mouth'], 'turns' => (bool) $liveness['turns'],
                    'nods' => (bool) ($liveness['nods'] ?? false), 'seconds' => (int) ($liveness['seconds'] ?? 0),
                ],
            ]);
        });
        AuditLog::record('face.captured', $enrollment->user, ['quality' => $quality, 'device' => $enrollment->device], $enrollment->institution_id);

        return $enrollment->fresh();
    }

    /** The decrypted photo. */
    public function image(FaceCapture $capture): string
    {
        return Crypt::decryptString((string) Storage::disk('local')->get($capture->path));
    }

    /** "Delete my face data" (or an admin removing it): files and rows go; exported copies are the school's. */
    public function forget(User $user): int
    {
        $n = 0;
        foreach (FaceEnrollment::where('user_id', $user->id)->get() as $e) {
            $this->deleteEnrollment($e);
            $n++;
        }
        Consent::create(['user_id' => $user->id, 'kind' => self::CONSENT_KIND, 'version' => self::CONSENT_VERSION, 'granted' => false]);

        return $n;
    }

    public function deleteEnrollment(FaceEnrollment $e): void
    {
        $this->deleteFiles($e);
        $e->delete();
    }

    private function deleteFiles(FaceEnrollment $e): void
    {
        foreach (FaceCapture::where('face_enrollment_id', $e->id)->get() as $c) {
            Storage::disk('local')->delete($c->path);
            $c->delete();
        }
    }

    /** 0-100: sharp, evenly lit, large enough face. Only a guide for the admin; the photos are kept as taken. */
    public function qualityOf(FaceCapture $c): float
    {
        $m = $c->metrics ?? [];
        $sharp = min(1, ((float) ($m['sharpness'] ?? 0)) / 120);
        $b = (float) ($m['brightness'] ?? 128);
        $light = max(0, 1 - abs($b - 135) / 110);
        $size = min(1, ((float) ($m['face_width'] ?? 0)) / 360);
        $res = min(1, ($c->width * $c->height) / (720 * 960));

        return round(100 * (0.35 * $sharp + 0.25 * $light + 0.25 * $size + 0.15 * $res), 2);
    }

    private function roundLandmarks(array $points): array
    {
        $out = [];
        foreach (array_slice($points, 0, 478) as $p) {
            if (is_array($p) && count($p) >= 2) {
                $out[] = [round((float) $p[0], 5), round((float) $p[1], 5), round((float) ($p[2] ?? 0), 5)];
            }
        }

        return $out;
    }
}
