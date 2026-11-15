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
 * it and approves, and this browser is signed in as that person. Only the browser that asked can use the code.
 */
class LinkController extends Controller
{
    public const TTL = 60; // seconds a code is shown before the page asks for a fresh one

    public function start(Request $request): JsonResponse
    {
        WebLink::where('expires_at', '<', now()->subHour())->delete(); // tidy up old codes

        $link = WebLink::create([
            'code' => Str::random(48),
            'browser' => $this->browser($request),
            'ip' => $request->ip(),
            'agent' => Str::limit((string) $request->userAgent(), 185, ''),
            'expires_at' => now()->addSeconds(self::TTL),
        ]);

        return response()->json(['code' => $link->code, 'qr' => 'sos-link:'.$link->code, 'expires_in' => self::TTL]);
    }

    /** The waiting page asks every couple of seconds; once the phone has approved, this browser is signed in. */
    public function check(Request $request, string $code): JsonResponse
    {
        $link = WebLink::where('code', $code)->where('browser', $this->browser($request))->first();
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

    private function browser(Request $request): string
    {
        return hash('sha256', 'link|'.$request->session()->getId());
    }
}
