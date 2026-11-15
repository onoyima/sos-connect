<?php

namespace App\Http\Middleware;

use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function share(Request $request): array
    {
        $user = $request->user();
        $institution = $user?->institution;

        return array_merge(parent::share($request), [
            'auth' => $user ? [
                'user' => [
                    'id' => $user->id, 'name' => $user->name, 'title' => $user->title, 'member_type' => $user->member_type,
                    'is_platform_admin' => (bool) $user->is_platform_admin,
                    'needs_policy_acceptance' => $user->policy_version !== config('sos.legal.policy_version'),
                ],
                'permissions' => $user->is_platform_admin ? ['platform.manage'] : Access::list($user),
                'super' => Access::isSuper($user),
                // Lets this page tell whether a "signed in on another browser" signal is about itself.
                'session_tag' => $request->hasSession() ? \App\Services\Auth\DeviceSessions::tag($request->session()->getId()) : null,
            ] : null,
            'modules' => $institution ? Modules::states($institution) : [],
            'institution' => $institution ? [
                'id' => $institution->id, 'name' => $institution->name, 'short_code' => $institution->short_code,
                'security_phone' => $institution->security_phone,
                'emergency_numbers' => config('sos.sos.national_emergency_numbers')[$institution->country]
                    ?? config('sos.sos.national_emergency_numbers.default'),
            ] : null,
            // Live updates: null fields mean "off" (pages then check for changes every few seconds instead).
            'reverb' => \App\Support\Realtime::clientSettings() ?? ['key' => null, 'host' => null, 'port' => null, 'scheme' => null],
            'flash' => [
                'status' => fn () => $request->session()->get('status'),
                'error' => fn () => $request->session()->get('error'),
            ],
        ]);
    }
}
