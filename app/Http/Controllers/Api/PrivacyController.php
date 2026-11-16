<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Consent;
use App\Models\DataRequest;
use App\Models\Message;
use App\Models\SosAlert;
use App\Models\StatusUpdate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Data-subject rights (NDPA ss.34–38, GDPR arts.15–22, POPIA s.23–25, Kenya DPA s.26).
 * Export is self-service and immediate. Other requests are logged with a 30-day deadline and routed to the
 * institution (the controller) and our DPO.
 */
class PrivacyController extends Controller
{
    public function export(Request $request): JsonResponse
    {
        $me = $request->user();
        AuditLog::record('privacy.export', $me);

        return response()->json([
            'generated_at' => now()->toIso8601String(),
            'profile' => $me->only(['name', 'email', 'identifier', 'phone', 'title', 'member_type', 'level', 'status', 'created_at', 'last_seen_at']),
            'institution' => $me->institution?->only(['name', 'short_code']),
            'consents' => Consent::where('user_id', $me->id)->get(['kind', 'version', 'granted', 'created_at']),
            'devices' => $me->devices()->get(['platform', 'created_at', 'last_sync_at', 'revoked_at']),
            'messages_sent' => Message::where('sender_id', $me->id)->latest()->limit(5000)->get()->map->toClient(),
            'sos_alerts' => SosAlert::where('user_id', $me->id)->get()->map->toClient(),
            'status_updates' => StatusUpdate::where('user_id', $me->id)->get(['body', 'audience', 'created_at', 'expires_at']),
        ], 200, ['Content-Disposition' => 'attachment; filename="my-sos-connect-data.json"']);
    }

    public function request(Request $request): JsonResponse
    {
        $data = $request->validate(['type' => 'required|in:erasure,rectification,objection,restriction', 'details' => 'nullable|string|max:2000']);
        $req = DataRequest::create($data + ['institution_id' => $request->user()->institution_id, 'user_id' => $request->user()->id,
            'status' => 'received', 'due_at' => now()->addDays(30)]);
        AuditLog::record('privacy.request', $req, ['type' => $data['type']]);

        return response()->json(['id' => $req->id, 'due_at' => $req->due_at->toIso8601String()], 201);
    }

    /**
     * "Delete my account": the account is closed (status "deleted"), not erased. The person is signed out everywhere
     * and hidden from others; the institution keeps the record and can trace it (Admin > Deleted accounts). An erasure
     * request goes to the institution's data protection officer, who decides what may be erased.
     */
    public function destroyAccount(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['confirm' => 'required|in:DELETE', 'reason' => 'nullable|string|max:1000']);
        abort_if($me->is_platform_admin && ! $me->institution_id, 422, 'Platform accounts are closed by another platform owner.');

        \App\Services\Accounts\AccountClosure::close($me, \App\Services\Auth\DeviceSessions::fromPhone($request) ? 'app' : 'web', $data['reason'] ?? null, null, $request);
        if ($request->hasSession()) {
            \Illuminate\Support\Facades\Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['ok' => true, 'message' => 'Your account is closed and you have been signed out. Your institution keeps a record of it; ask your school if you want it restored.']);
    }
}
