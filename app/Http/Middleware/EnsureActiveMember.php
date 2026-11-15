<?php

namespace App\Http\Middleware;

use App\Services\Auth\DeviceSessions;
use App\Support\CurrentInstitution;
use Illuminate\Support\Facades\Auth;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs on every signed-in request: the account and its institution must be active (suspension takes
 * effect immediately, not at next login), and the tenant scope is set for the rest of the request.
 */
class EnsureActiveMember
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user) {
            return $this->deny($request, 401, 'Not signed in.');
        }
        if ($user->status !== 'active') {
            $token = $user->currentAccessToken();
            if ($token instanceof \Laravel\Sanctum\PersonalAccessToken) {
                $token->delete();
            }

            return $this->deny($request, 403, 'Your account is not active.');
        }
        // Edge-node relay accounts may only upload carried envelopes.
        if ($user->member_type === 'relay' && ! $request->is('api/mesh/relay')) {
            return $this->deny($request, 403, 'Relay accounts can only upload envelopes.');
        }

        // One web browser per account: a browser that was replaced (or signed out from the phone) is signed out here.
        if ($user->web_session_id && $request->hasSession() && ! DeviceSessions::fromPhone($request)
            && $user->web_session_id !== $request->session()->getId()) {
            $why = $user->web_session_id === DeviceSessions::REVOKED ? 'phone' : 'replaced';
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            $message = $why === 'phone'
                ? 'This browser was signed out from your phone.'
                : 'Your account was opened on another browser, so it was signed out here.';
            if ($request->expectsJson()) {
                return response()->json(['message' => $message, 'session_expired' => true, 'signed_out' => $why], 401);
            }

            return redirect('/login?'.$why.'=1');
        }

        if (! $user->is_platform_admin) {
            $institution = $user->institution;
            // While an institution is still being set up, its own admins may reach the setup screens.
            $settingUp = $institution?->status === 'pending' && $user->auth_source === 'local' && $user->member_type === 'admin'
                && $request->routeIs('admin.settings*', 'admin.connector*', 'admin.roles*', 'admin.structure*', 'admin.modules*', 'logout', 'legal.*');
            if (! $institution || (! $institution->isActive() && ! $settingUp)) {
                return $this->deny($request, 403, 'Your institution is not active on SOS Connect.');
            }
            CurrentInstitution::set($user->institution_id);
        }

        // Cheap "last seen" that writes at most once a minute per user.
        if (! $user->last_seen_at || $user->last_seen_at->lt(now()->subMinute())) {
            $user->forceFill(['last_seen_at' => now()])->saveQuietly();
        }

        return $next($request);
    }

    private function deny(Request $request, int $status, string $message): Response
    {
        if ($request->expectsJson()) {
            return response()->json(['message' => $message], $status);
        }

        return redirect()->route('login')->withErrors(['identifier' => $message]);
    }
}
