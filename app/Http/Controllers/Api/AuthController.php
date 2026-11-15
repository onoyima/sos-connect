<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Institution;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\SignIn;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class AuthController extends Controller
{
    public function login(Request $request, SignIn $signIn): JsonResponse
    {
        $data = $request->validate([
            'identifier' => 'required|string|max:190',
            'password' => 'required|string|max:200',
            'device_name' => 'nullable|string|max:60',
        ]);

        $key = 'login:'.$request->ip().'|'.mb_strtolower($data['identifier']);
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return response()->json(['message' => 'Too many attempts. Try again in '.ceil(RateLimiter::availableIn($key) / 60).' minutes.'], 429);
        }

        $result = $signIn->attempt($data['identifier'], $data['password']);
        if ($result['ok'] && ! $result['user']->institution_id) {
            $result = ['ok' => false, 'error' => SignIn::FAILED]; // platform operators use the website
        }
        if (! $result['ok']) {
            RateLimiter::hit($key, 15 * 60);

            return response()->json(['message' => $result['error']], 422);
        }
        RateLimiter::clear($key);

        $user = $result['user'];
        $token = $user->createToken($data['device_name'] ?? 'mobile', ['*'], now()->addDays(30));
        DeviceSessions::claimPhone($user, $token->accessToken->id); // one phone at a time

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => now()->addDays(30)->toIso8601String(),
            'user' => $this->userPayload($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();
        DeviceSessions::phoneSignedOut($request->user());

        return response()->json(['ok' => true]);
    }

    public static function userPayload($user): array
    {
        $institution = $user->institution;

        return [
            'id' => $user->id,
            'name' => $user->name,
            'title' => $user->title,
            'member_type' => $user->member_type,
            'identifier' => $user->identifier,
            'department' => $user->department?->name,
            'faculty' => $user->faculty?->name,
            'level' => $user->level,
            'programme' => $user->programme,
            'residence' => $user->residence,
            // Parents see the children linked to them (name and where they study only).
            'children' => $user->member_type === 'parent' ? \App\Support\CurrentInstitution::as($user->institution_id, fn () => \App\Models\GuardianLink::where('parent_id', $user->id)
                ->with('student.department')->get()->filter(fn ($l) => $l->student)->map(fn ($l) => [
                    'name' => $l->student->name, 'relationship' => $l->relationship, 'department' => $l->student->department?->name, 'level' => $l->student->level,
                ])->values()->all()) : [],
            'permissions' => Permissions::for($user),
            'modules' => \App\Support\Modules::states($user->institution),
            'needs_policy_acceptance' => $user->policy_version !== config('sos.legal.policy_version'),
            'needs_guardian_consent' => $user->is_minor && ! $user->guardian_consent_at && ! $user->institution?->setting('minor_consent_at_admission'),
            'institution' => $institution ? [
                'id' => $institution->id, 'name' => $institution->name, 'short_code' => $institution->short_code,
                'country' => $institution->country, 'security_phone' => $institution->security_phone,
                'emergency_numbers' => config('sos.sos.national_emergency_numbers')[$institution->country]
                    ?? config('sos.sos.national_emergency_numbers.default'),
            ] : null,
        ];
    }
}
