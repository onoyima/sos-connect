<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Consent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['user' => AuthController::userPayload($request->user())]);
    }

    /** Record acceptance of the current Terms + Privacy Policy, and the separate SOS-location choice. */
    public function acceptPolicies(Request $request): JsonResponse
    {
        $data = $request->validate([
            'version' => 'required|string|in:'.config('sos.legal.policy_version'),
            'sos_location' => 'required|boolean',
        ]);
        $user = $request->user();

        foreach (['terms' => true, 'privacy' => true, 'sos_location' => $data['sos_location']] as $kind => $granted) {
            Consent::create(['user_id' => $user->id, 'kind' => $kind, 'version' => $data['version'], 'granted' => $granted,
                'ip_address' => $request->ip(), 'user_agent' => mb_substr((string) $request->userAgent(), 0, 255)]);
        }
        $user->forceFill(['policy_version' => $data['version'], 'policy_accepted_at' => now()])->save();

        return response()->json(['user' => AuthController::userPayload($user)]);
    }

    /**
     * Members under 18 need a parent/guardian's consent (NDPA s.31). The institution usually already holds
     * it from admission; its admin confirms here, or the guardian confirms through the emailed link flow.
     */
    public function recordGuardianConsent(Request $request, int $userId): JsonResponse
    {
        $data = $request->validate(['source' => 'required|string|in:admission_records,guardian_form', 'reference' => 'nullable|string|max:120']);
        $member = $request->user()->colleagues()->findOrFail($userId);
        abort_unless(\App\Support\Access::canOnUser($request->user(), 'members.consent', $member), 403);
        $member->forceFill(['guardian_consent_at' => now()])->save();
        Consent::create(['user_id' => $member->id, 'kind' => 'guardian', 'version' => config('sos.legal.policy_version'), 'granted' => true,
            'ip_address' => $request->ip(), 'user_agent' => 'recorded by '.$request->user()->id.' from '.$data['source']]);
        AuditLog::record('member.guardian_consent', $member, $data);

        return response()->json(['ok' => true]);
    }
}
