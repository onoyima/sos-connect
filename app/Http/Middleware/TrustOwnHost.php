<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The website calls its own /api with the signed-in session cookie. Sanctum only accepts that from addresses listed
 * in SANCTUM_STATEFUL_DOMAINS (by default localhost and APP_URL's host), so a site served from another address (a new
 * domain, the server's IP, APP_URL left as localhost) got 401 on every API call and kept bouncing to sign-in.
 * This site's own address is always first-party: a request whose Origin/Referer is this same host is same-origin,
 * and CSRF protection still applies to it.
 */
class TrustOwnHost
{
    public function handle(Request $request, Closure $next): Response
    {
        $host = $request->getHttpHost();
        $stateful = (array) config('sanctum.stateful', []);
        if ($host !== '' && ! in_array($host, $stateful, true)) {
            config(['sanctum.stateful' => [...$stateful, $host]]);
        }

        return $next($request);
    }
}
