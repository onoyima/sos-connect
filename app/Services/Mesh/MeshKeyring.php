<?php

namespace App\Services\Mesh;

use App\Models\MeshKey;
use App\Support\CurrentInstitution;

/**
 * Per-institution symmetric keys (XSalsa20-Poly1305 secretbox) for mesh traffic. Members receive them
 * while online; phones of other institutions can carry the envelopes but cannot read them.
 * Rotated every 30 days and immediately after a member is suspended or leaves.
 */
class MeshKeyring
{
    public function current(int $institutionId): MeshKey
    {
        return CurrentInstitution::as($institutionId, function () use ($institutionId) {
            $key = MeshKey::whereNull('retired_at')->latest('active_from')->first();
            $maxAge = now()->subDays(config('sos.mesh.key_rotation_days'));

            return ($key && $key->active_from->gt($maxAge)) ? $key : $this->rotate($institutionId);
        });
    }

    public function rotate(int $institutionId): MeshKey
    {
        return CurrentInstitution::as($institutionId, function () use ($institutionId) {
            MeshKey::whereNull('retired_at')->update(['retired_at' => now()]);

            return MeshKey::create([
                'institution_id' => $institutionId,
                'key_id' => bin2hex(random_bytes(8)),
                'secret' => base64_encode(random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES)),
                'active_from' => now(),
            ]);
        });
    }

    /** Keys a member's phone should hold: the current key plus keys retired in the last 7 days. */
    public function forDevice(int $institutionId): array
    {
        $current = $this->current($institutionId);

        return CurrentInstitution::as($institutionId, fn () => MeshKey::query()
            ->where(fn ($q) => $q->whereNull('retired_at')->orWhere('retired_at', '>', now()->subDays(7)))
            ->orderByDesc('active_from')
            ->get()
            ->map(fn (MeshKey $k) => ['kid' => $k->key_id, 'key' => $k->secret, 'current' => $k->id === $current->id])
            ->all());
    }

    public function find(int $institutionId, string $keyId): ?string
    {
        $key = CurrentInstitution::as($institutionId, fn () => MeshKey::where('key_id', $keyId)->first());

        return $key ? base64_decode($key->secret) : null;
    }
}
