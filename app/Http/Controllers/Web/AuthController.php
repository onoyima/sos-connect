<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Institution;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\SignIn;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;
use Inertia\Response;

class AuthController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('Auth/Login');
    }

    /** One form for everyone; the school is worked out on the server (see SignIn). */
    public function login(Request $request, SignIn $signIn): RedirectResponse
    {
        $data = $request->validate([
            'identifier' => 'required|string|max:190',
            'password' => 'required|string|max:200',
        ]);

        $guard = new \App\Services\Auth\LoginGuard($request, $data['identifier']);
        if ($wait = $guard->blocked()) {
            return back()->withErrors(['identifier' => $wait]);
        }

        $result = $signIn->attempt($data['identifier'], $data['password']);
        if (! $result['ok']) {
            $guard->failed();

            return back()->withErrors(['identifier' => $result['error']])->onlyInput('identifier');
        }
        $guard->succeeded();

        $user = $result['user'];
        Auth::login($user);
        $request->session()->regenerate();
        DeviceSessions::claimWeb($user, $request, 'password'); // one browser at a time

        return self::home($user);
    }

    /** Where someone lands after signing in. */
    public static function home(User $user): RedirectResponse
    {
        if ($user->is_platform_admin && ! $user->institution_id) {
            return redirect()->route('platform.institutions');
        }
        if ($user->institution?->status === 'pending') {
            return redirect()->route('admin.settings')->with('status', 'Finish connecting your records. Your institution is switched on once the connection test passes.');
        }

        return redirect()->intended(route('chats'));
    }

    public function logout(Request $request): RedirectResponse
    {
        if ($user = $request->user()) {
            if ($user->web_session_id === $request->session()->getId()) {
                DeviceSessions::endWeb($user);
            }
        }
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }
}
