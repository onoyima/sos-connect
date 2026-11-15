<?php

namespace App\Services\Mesh;

use App\Models\Device;
use App\Models\User;
use RuntimeException;

/**
 * Issues and checks device certificates. A certificate says "this public key belongs to user X of
 * institution Y until date Z", signed with the platform's Ed25519 key. Phones carry the platform
 * public key built in, so they can check each other's certificates with no internet at all.
 *
 * Canonical form (identical in mobile/src/mesh/protocol.ts and edge-node/src/protocol.mjs):
 *   "SOSCERTv1\n{cid}\n{uid}\n{iid}\n{did}\n{spk}\n{bpk}\n{role}\n{name}\n{exp}"
 */
class PlatformSigner
{
    public function issue(User $user, Device $device): array
    {
        $exp = now()->addDays(config('sos.certificate_days'))->getTimestamp();
        $cert = [
            'v' => 1,
            'cid' => bin2hex(random_bytes(8)),
            'uid' => $user->id,
            'iid' => $user->institution_id,
            'did' => $device->id,
            'spk' => $device->sign_public_key,
            'bpk' => $device->box_public_key,
            // Kind of account, plus "+notices" when they may post institution-wide notices (so phones can trust
            // offline announcements without the server). Certificates are short-lived, so role changes catch up.
            'role' => $user->member_type.(\App\Support\Access::canEverywhere($user, 'announcements.create') ? '+notices' : ''),
            'name' => mb_substr($user->name, 0, 60),
            'exp' => $exp,
        ];
        $cert['sig'] = base64_encode(sodium_crypto_sign_detached(self::canonicalCert($cert), $this->secret()));
        $device->update(['cert_expires_at' => now()->setTimestamp($exp)]);

        return $cert;
    }

    public function verifyCert(array $cert, int $graceSeconds = 0): bool
    {
        foreach (['cid', 'uid', 'iid', 'did', 'spk', 'bpk', 'role', 'name', 'exp', 'sig'] as $k) {
            if (! isset($cert[$k])) {
                return false;
            }
        }
        if ((int) $cert['exp'] + $graceSeconds < time()) {
            return false;
        }
        $sig = base64_decode((string) $cert['sig'], true);
        if ($sig === false || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return false;
        }

        return sodium_crypto_sign_verify_detached($sig, self::canonicalCert($cert), $this->publicKey());
    }

    public static function canonicalCert(array $c): string
    {
        return implode("\n", ['SOSCERTv1', $c['cid'], $c['uid'], $c['iid'], $c['did'], $c['spk'], $c['bpk'], $c['role'], $c['name'], $c['exp']]);
    }

    public function publicKey(): string
    {
        $pk = base64_decode((string) config('sos.platform_sign_public'), true);
        if (! $pk || strlen($pk) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            throw new RuntimeException('SOS_PLATFORM_SIGN_PUBLIC is not set. Run php artisan sos:platform-keys');
        }

        return $pk;
    }

    private function secret(): string
    {
        $sk = base64_decode((string) config('sos.platform_sign_secret'), true);
        if (! $sk || strlen($sk) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
            throw new RuntimeException('SOS_PLATFORM_SIGN_SECRET is not set. Run php artisan sos:platform-keys');
        }

        return $sk;
    }
}
