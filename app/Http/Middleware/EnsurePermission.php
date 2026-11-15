<?php

namespace App\Http\Middleware;

use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();
        $ok = $permission === 'platform.manage' ? (bool) $user?->is_platform_admin : Permissions::allows($user, $permission);
        abort_unless($ok, 403, 'You do not have permission to do this.');

        return $next($request);
    }
}
