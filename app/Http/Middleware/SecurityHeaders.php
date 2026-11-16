<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Vite;
use Symfony\Component\HttpFoundation\Response;

/**
 * Browser-side protection on every response:
 *  - Content-Security-Policy: only this site's own scripts run (plus the one inline start-up script, by nonce), so
 *    injected script tags or event handlers do nothing; no framing (clickjacking); no plugins; forms post only here.
 *  - HSTS on HTTPS, no MIME sniffing, no referrer leaks across sites, camera/mic/location for this site only,
 *    windows opened from here can't reach back (COOP), and signed-in pages are never cached.
 * SECURITY_CSP=report sends violations to /csp-report without blocking (to try a change); off disables it.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $mode = config('sos.security.csp', 'enforce');
        $nonce = $mode !== 'off' ? Vite::useCspNonce() : null;

        $response = $next($request);
        $h = $response->headers;
        $h->set('X-Content-Type-Options', 'nosniff');
        $h->set('X-Frame-Options', 'DENY');
        $h->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $h->set('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self), payment=(), usb=(), interest-cohort=()');
        $h->set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        $h->set('X-Permitted-Cross-Domain-Policies', 'none');
        $h->remove('X-Powered-By');
        header_remove('X-Powered-By');

        $type = (string) $h->get('Content-Type');
        // Signed-in pages and data are never stored by the browser, so Back after signing out can't show them.
        if ($request->user() && (str_contains($type, 'text/html') || str_contains($type, 'json'))) {
            $h->set('Cache-Control', 'no-store, private, max-age=0');
        }
        if ($request->isSecure()) {
            $h->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        if ($nonce && str_contains($type, 'text/html') && ! Vite::isRunningHot()) {
            $h->set($mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', self::policy($nonce));
        }

        return $response;
    }

    public static function policy(string $nonce): string
    {
        $live = \App\Support\Realtime::clientSettings();
        $ws = $live && $live['host'] ? ' '.($live['scheme'] === 'https' ? 'wss' : 'ws').'://'.$live['host'].':'.$live['port'] : '';

        return implode('; ', [
            "default-src 'self'",
            // 'wasm-unsafe-eval' lets the face-capture engine (WebAssembly) start; it does not allow eval() of text.
            "script-src 'self' 'nonce-{$nonce}' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.bunny.net",
            "font-src 'self' data: https://fonts.bunny.net",
            "img-src 'self' data: blob:",
            "media-src 'self' data: blob:",
            "connect-src 'self'{$ws} https://storage.googleapis.com",
            "worker-src 'self' blob:",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self' https://checkout.paystack.com",
            'report-uri /csp-report',
        ]);
    }
}
