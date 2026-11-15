<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)');
        // Signed-in pages and data are never stored by the browser, so Back after signing out can't show them.
        $type = (string) $response->headers->get('Content-Type');
        if ($request->user() && (str_contains($type, 'text/html') || str_contains($type, 'json'))) {
            $response->headers->set('Cache-Control', 'no-store, private, max-age=0');
        }
        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
