<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\WebLink;
use App\Services\Auth\DeviceSessions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * "Link with your phone" on the sign-in page (like WhatsApp Web): the page shows a QR code, the phone app scans
 * it and approves, and this browser is signed in as that person. Only the browser that asked (it holds a secret key that is never shown) can use the approval.
 */
class LinkController extends Controller
{
    public const TTL = 60; // seconds a code is shown before the page asks for a fresh one

    public function start(Request $request): JsonResponse
    {
        WebLink::where('expires_at', '<', now()->subHour())->delete(); // tidy up old codes

        $key = Str::random(40); // stays inside the page (never in the QR code), so only this browser can use the approval
        $link = WebLink::create([
            'code' => Str::random(48),
            'browser' => hash('sha256', 'link|'.$key),
            'ip' => $request->ip(),
            'agent' => Str::limit((string) $request->userAgent(), 185, ''),
            'expires_at' => now()->addSeconds(self::TTL),
        ]);

        return response()->json(['code' => $link->code, 'key' => $key, 'qr' => 'sos-link:'.$link->code, 'expires_in' => self::TTL]);
    }

    /** The waiting page asks every couple of seconds; once the phone has approved, this browser is signed in. */
    public function check(Request $request, string $code): JsonResponse
    {
        $key = (string) $request->header('X-Link-Key');
        $link = $key === '' ? null : WebLink::where('code', $code)->where('browser', hash('sha256', 'link|'.$key))->first();
        if (! $link || $link->status === 'used') {
            return response()->json(['status' => 'expired']);
        }
        if ($link->status === 'pending') {
            return response()->json(['status' => $link->expired() ? 'expired' : 'pending']);
        }

        // Approved by the phone (within the last two minutes).
        $user = $link->user;
        $link->update(['status' => 'used']);
        if (! $user || $user->status !== 'active' || DeviceSessions::isAdmin($user) || ($link->approved_at && $link->approved_at->lt(now()->subMinutes(2)))) {
            return response()->json(['status' => 'expired']);
        }

        Auth::login($user);
        $request->session()->regenerate();
        DeviceSessions::claimWeb($user, $request, 'qr');

        return response()->json(['status' => 'linked', 'redirect' => AuthController::home($user)->getTargetUrl()]);
    }
}
