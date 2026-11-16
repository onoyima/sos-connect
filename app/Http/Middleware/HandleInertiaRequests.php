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
                // A platform admin who also belongs to a school keeps everything their school role gives them (chat included).
                'permissions' => $user->is_platform_admin
                    ? ($user->institution_id ? array_values(array_unique([...Access::list($user), 'platform.manage'])) : ['platform.manage'])
                    : Access::list($user),
                'super' => Access::isSuper($user),
                // School admins see where their subscription stands (trial ending, payment due, lapsed).
                'billing' => fn () => $user->institution_id && Access::can($user, 'settings.edit') ? \App\Services\Billing\Billing::summary($institution) : null,
                // Platform owners and school admins get the platform chat widget.
                'platform_chat' => fn () => \App\Services\PlatformChat\PlatformChat::canUse($user),
                // Lets this page tell whether a "signed in on another browser" signal is about itself.
                // Face capture is required here and this person hasn't done it yet: a reminder shows on every page.
                'face_due' => fn () => $user->institution_id && \App\Support\Modules::enabled($institution, 'face_capture_required')
                    && \App\Support\Access::can($user, 'face.capture')
                    && ! \App\Models\FaceEnrollment::where('user_id', $user->id)->where('status', 'complete')->exists(),
                'session_tag' => $request->hasSession() ? \App\Services\Auth\DeviceSessions::tag($request->session()->getId()) : null,
            ] : null,
            'modules' => $institution ? Modules::states($institution) : [],
            // Favicon, chat icon and today's seasonal touch (Christmas, Easter, Eid…).
            'branding' => \App\Support\Branding::forClient($institution),
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
