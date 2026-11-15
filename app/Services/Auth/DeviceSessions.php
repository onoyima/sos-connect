<?php

namespace App\Services\Auth;

use App\Events\UserSignal;
use App\Models\Device;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Where an account is signed in: at most one phone and one web browser at the same time.
 *  - Signing in on another phone signs the old phone out (and a browser that was linked to it by QR).
 *  - Signing in on another browser signs the old browser out.
 *  - The phone is the main device: a browser can be linked from the phone by scanning a QR code.
 *    Admin accounts don't link; they sign in to the website with their password.
 */
class DeviceSessions
{
    /** Marker for "the browser was signed out from the phone" (never matches a real session id). */
    public const REVOKED = 'revoked';

    public static function isAdmin(User $user): bool
    {
        return (bool) $user->is_platform_admin || $user->member_type === 'admin';
    }

    /** A short public tag for a browser session, so a page can tell whether a "replaced" signal is about itself. */
    public static function tag(?string $sessionId): ?string
    {
        return $sessionId ? substr(hash('sha256', 'web|'.$sessionId), 0, 16) : null;
    }

    /** True when the request comes from the phone app (a personal token), not from a browser session. */
    public static function fromPhone(Request $request): bool
    {
        return $request->user()?->currentAccessToken() instanceof PersonalAccessToken;
    }

    /** This browser is now the account's web session; any other browser is signed out. */
    public static function claimWeb(User $user, Request $request, string $via): void
    {
        $old = $user->web_session_id;
        $new = $request->session()->getId();
        $user->forceFill([
            'web_session_id' => $new,
            'web_session_via' => $via,
            'web_session_at' => now(),
            'web_session_agent' => Str::limit((string) $request->userAgent(), 185, ''),
            'web_session_ip' => $request->ip(),
        ])->saveQuietly();

        if ($old && $old !== $new) {
            self::dropSession($old);
            UserSignal::dispatch($user->id, 'session.replaced', ['device' => 'web', 'keep' => self::tag($new)]);
        }
    }

    /** Ends the account's web session (signed out on the website, or from the phone). */
    public static function endWeb(User $user, bool $fromPhone = false): void
    {
        $old = $user->web_session_id;
        if (! $old || $old === self::REVOKED) {
            return;
        }
        self::dropSession($old);
        $user->forceFill([
            'web_session_id' => $fromPhone ? self::REVOKED : null,
            'web_session_via' => null, 'web_session_at' => null, 'web_session_agent' => null, 'web_session_ip' => null,
        ])->saveQuietly();
        if ($fromPhone) {
            UserSignal::dispatch($user->id, 'session.replaced', ['device' => 'web', 'keep' => null]);
        }
    }

    /** A new phone signed in: every older phone sign-in ends, and so does a browser that was linked to the old phone. */
    public static function claimPhone(User $user, int $newTokenId): void
    {
        $old = $user->tokens()->where('id', '!=', $newTokenId)->pluck('id');
        if ($old->isEmpty()) {
            return;
        }
        foreach ($old as $id) {
            Cache::put("replaced-token:{$id}", true, now()->addDays(30)); // lets the old phone say why it was signed out
        }
        $user->tokens()->whereIn('id', $old)->delete();
        // Old phones stop getting notifications; the new phone registers its own push token right after signing in.
        Device::withoutGlobalScopes()->where('user_id', $user->id)->update(['push_token' => null]);
        UserSignal::dispatch($user->id, 'session.replaced', ['device' => 'phone', 'keep' => $newTokenId]);

        if ($user->web_session_via === 'qr') {
            self::endWeb($user, true);
        }
    }

    /** The phone signed out: a browser linked from it goes too. */
    public static function phoneSignedOut(User $user): void
    {
        if ($user->web_session_via === 'qr') {
            self::endWeb($user, true);
        }
    }

    public static function webInfo(User $user): ?array
    {
        if (! $user->web_session_id || $user->web_session_id === self::REVOKED) {
            return null;
        }

        return [
            'since' => $user->web_session_at?->toIso8601String(),
            'via' => $user->web_session_via,
            'browser' => self::describeAgent($user->web_session_agent),
            'ip' => $user->web_session_ip,
        ];
    }

    public static function describeAgent(?string $agent): string
    {
        $a = (string) $agent;
        $browser = match (true) {
            str_contains($a, 'Edg/') => 'Edge',
            str_contains($a, 'OPR/') || str_contains($a, 'Opera') => 'Opera',
            str_contains($a, 'Firefox/') => 'Firefox',
            str_contains($a, 'Chrome/') => 'Chrome',
            str_contains($a, 'Safari/') => 'Safari',
            default => 'A web browser',
        };
        $os = match (true) {
            str_contains($a, 'Windows') => 'Windows',
            str_contains($a, 'Mac OS') => 'Mac',
            str_contains($a, 'Android') => 'Android',
            str_contains($a, 'iPhone') || str_contains($a, 'iPad') => 'iOS',
            str_contains($a, 'Linux') => 'Linux',
            default => null,
        };

        return $os ? "{$browser} on {$os}" : $browser;
    }

    private static function dropSession(string $sessionId): void
    {
        if ($sessionId === self::REVOKED) {
            return;
        }
        if (config('session.driver') === 'database') {
            DB::table(config('session.table', 'sessions'))->where('id', $sessionId)->delete();
        }
        // Other drivers: the old browser is signed out on its next request (see EnsureActiveMember).
    }
}
