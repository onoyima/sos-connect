<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\Mesh\MeshKeyring;
use App\Services\Mesh\PlatformSigner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A phone registers its own public keys and receives (1) a certificate signed by the platform, (2) the
 * platform's public key, (3) the institution's current mesh keys. With these it can prove who it is and
 * read institution traffic while completely offline. Called at login and whenever the certificate is
 * within 7 days of expiry.
 */
class DeviceController extends Controller
{
    public function register(Request $request, PlatformSigner $signer, MeshKeyring $keys): JsonResponse
    {
        $data = $request->validate([
            'device_uid' => 'required|string|max:64',
            'platform' => 'required|string|in:android,ios,web',
            'sign_public_key' => 'required|string|size:44',   // base64 of 32 bytes
            'box_public_key' => 'required|string|size:44',
            'push_token' => 'nullable|string|max:255',
        ]);
        foreach (['sign_public_key', 'box_public_key'] as $k) {
            abort_unless(strlen((string) base64_decode($data[$k], true)) === 32, 422, "Invalid $k");
        }

        $user = $request->user();
        $device = Device::updateOrCreate(
            ['user_id' => $user->id, 'device_uid' => $data['device_uid']],
            $data + ['institution_id' => $user->institution_id, 'revoked_at' => null, 'last_sync_at' => now()],
        );

        return response()->json([
            'device_id' => $device->id,
            'certificate' => $signer->issue($user, $device),
            'platform_public_key' => base64_encode($signer->publicKey()),
            'mesh_keys' => $keys->forDevice($user->institution_id),
            'allow_foreign_relay' => (bool) $user->institution->setting('allow_foreign_relay'),
        ]);
    }

    public function updatePushToken(Request $request, int $id): JsonResponse
    {
        $device = Device::where('user_id', $request->user()->id)->findOrFail($id);
        $device->update($request->validate(['push_token' => 'nullable|string|max:255']));

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        Device::where('user_id', $request->user()->id)->findOrFail($id)->update(['revoked_at' => now(), 'push_token' => null]);

        return response()->json(['ok' => true]);
    }
}
