<?php

use App\Http\Middleware\EnsureActiveMember;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(__DIR__.'/../routes/channels.php', ['middleware' => ['auth:sanctum']])
    ->withMiddleware(function (Middleware $middleware): void {
        // Real client IPs behind a load balancer / Cloudflare / Nginx.
        $middleware->trustProxies(at: '*', headers: Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO);
        // The site's own address is always allowed to use /api with its session (see TrustOwnHost).
        $middleware->prepend(\App\Http\Middleware\TrustOwnHost::class);

        $middleware->web(append: [
            HandleInertiaRequests::class,
            SecurityHeaders::class,
        ]);
        $middleware->api(append: [SecurityHeaders::class]);
        $middleware->statefulApi();
        $middleware->redirectUsersTo('/chats'); // the Inertia web app uses the same /api routes with its session cookie
        $middleware->redirectGuestsTo('/login');

        // The tenant scope must be set BEFORE route-model binding loads {conversation}, {message}, etc.
        $middleware->prependToPriorityList(
            before: \Illuminate\Routing\Middleware\SubstituteBindings::class,
            prepend: EnsureActiveMember::class,
        );

        $middleware->alias([
            'member' => EnsureActiveMember::class,
            'can.do' => EnsurePermission::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Never leak stack traces or SQL to clients in production.
        $exceptions->dontReportDuplicates();

        // A JSON caller (the phones, the web app's fetch calls) gets JSON; a page visit gets a page.
        $wantsJson = fn (Request $r) => ! $r->header('X-Inertia') && ($r->expectsJson() || $r->is('api/*'));

        // The code was updated but the database wasn't (php artisan migrate didn't run or failed): say so plainly
        // instead of a bare "Server Error", so whoever looks knows exactly what to do. The full error is still logged.
        $exceptions->render(function (\Illuminate\Database\QueryException $e, Request $request) use ($wantsJson) {
            $m = $e->getMessage();
            if (! str_contains($m, "doesn't exist") && ! str_contains($m, 'no such table') && ! str_contains($m, 'Unknown column') && ! str_contains($m, 'no such column')) {
                return null;
            }
            $text = 'The server is being updated: its database is behind the app. An administrator needs to run "php artisan migrate --force" on the server.';
            if ($wantsJson($request)) {
                return response()->json(['message' => $text, 'needs_migration' => true], 503);
            }

            return response($text, 503);
        });

        // Not signed in, or the session ran out: back to sign-in (then on to where they were going).
        $exceptions->render(function (AuthenticationException $e, Request $request) use ($wantsJson) {
            if ($wantsJson($request)) {
                // A phone whose sign-in was replaced by another phone is told why.
                $tokenId = (int) strtok((string) $request->bearerToken(), '|');
                if ($tokenId && \Illuminate\Support\Facades\Cache::get("replaced-token:{$tokenId}")) {
                    return response()->json(['message' => 'Your account was signed in on another phone, so it was signed out here.', 'session_expired' => true, 'signed_out' => 'replaced'], 401);
                }

                return response()->json(['message' => 'Your session has ended. Please sign in again.', 'session_expired' => true], 401);
            }

            return redirect()->guest('/login')->with('error', 'Your session has ended. Please sign in again.');
        });

        $exceptions->respond(function (Response $response, Throwable $e, Request $request) use ($wantsJson) {
            $status = $response->getStatusCode();

            // 419 "page expired": the session or its security token ran out. Never leave anyone on a dead page:
            // sign out cleanly (new session, new token) and go to sign-in with a clear message.
            if ($status === 419) {
                if ($request->hasSession()) {
                    Auth::guard('web')->logout();
                    $request->session()->invalidate();
                    $request->session()->regenerateToken();
                }
                if ($wantsJson($request)) {
                    return response()->json(['message' => 'Your session has expired. Please sign in again.', 'session_expired' => true], 419);
                }

                return redirect('/login')->with('error', 'Your session expired, so you were signed out to keep your account safe. Please sign in again.');
            }

            // Friendly pages with a way out (Home, Back, Sign in) instead of the framework's bare error pages.
            // While developing, server errors keep the detailed page so they can be fixed.
            $friendly = [403, 404, 405, 429, 500, 502, 503];
            if (in_array($status, $friendly, true) && ! $wantsJson($request) && ! ($status >= 500 && config('app.debug'))) {
                $message = $status === 403 && $e->getMessage() !== '' && $e->getMessage() !== 'This action is unauthorized.' ? $e->getMessage() : null;

                return Inertia::render('Error', ['status' => $status, 'message' => $message, 'signedIn' => Auth::check()])
                    ->toResponse($request)->setStatusCode($status);
            }

            return $response;
        });
    })->create();
