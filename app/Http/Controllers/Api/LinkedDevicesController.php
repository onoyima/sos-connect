<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WebLink;
use App\Services\Auth\DeviceSessions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The phone is the main device: it links a web browser by scanning its QR code, and can sign that browser out. */
class LinkedDevicesController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'web' => DeviceSessions::webInfo($user),
            'can_link' => ! DeviceSessions::isAdmin($user),
        ]);
    }

    public function approve(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => 'required|string|max:80']);
        $user = $request->user();

        if (! DeviceSessions::fromPhone($request)) {
            abort(403, 'Scan the code with the SOS Connect app on your phone.');
        }
        if (DeviceSessions::isAdmin($user)) {
            abort(403, 'Admin accounts sign in to the website with their password, not by linking a phone.');
        }

        $code = preg_replace('/^sos-link:/', '', trim($data['code']));
        $link = WebLink::where('code', $code)->first();
        if (! $link || $link->status !== 'pending' || $link->expired()) {
            return response()->json(['message' => 'That code has expired. Reload the page on the computer and scan the new code.'], 422);
        }
        $link->update(['user_id' => $user->id, 'status' => 'approved', 'approved_at' => now()]);

        return response()->json(['ok' => true, 'browser' => DeviceSessions::describeAgent($link->agent)]);
    }

    /** Sign the linked browser out from the phone. */
    public function destroyWeb(Request $request): JsonResponse
    {
        DeviceSessions::endWeb($request->user(), true);

        return response()->json(['ok' => true]);
    }
}
