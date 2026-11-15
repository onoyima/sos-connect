<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The platform owner (operator) account belongs to no institution, so it has no chats, SOS or notices of its own.
 * Member pages send it to its home, the list of institutions, instead of showing "Chat isn't on for your account".
 */
class PlatformHome
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user && $user->is_platform_admin && ! $user->institution_id) {
            return $request->header('X-Inertia')
                ? \Inertia\Inertia::location(route('platform.institutions'))
                : redirect()->route('platform.institutions');
        }

        return $next($request);
    }
}
