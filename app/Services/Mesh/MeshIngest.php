<?php

namespace App\Services\Mesh;

use App\Events\UserSignal;
use App\Models\Conversation;
use App\Models\Device;
use App\Models\Institution;
use App\Models\MeshEnvelope;
use App\Models\SafetyCheck;
use App\Models\SafetyCheckResponse;
use App\Models\SosAlert;
use App\Models\User;
use App\Services\Chat\MessageService;
use App\Services\Sos\SosService;
use App\Support\CurrentInstitution;
use Throwable;

/**
 * Accepts envelopes that travelled phone-to-phone (Bluetooth / Wi-Fi) and were uploaded by whichever phone
 * reached the internet first ("gateway"). The gateway can belong to any institution: it only carries
 * ciphertext. We check the sender's certificate and signature, drop duplicates, then turn the envelope into
 * a normal message / SOS / safety response exactly as if the sender had been online.
 */
class MeshIngest
{
    public function __construct(
        private readonly PlatformSigner $signer,
        private readonly MeshKeyring $keys,
        private readonly MessageService $messages,
        private readonly SosService $sos,
    ) {}

    /** @return string result code */
    public function ingest(array $e, ?User $gateway): string
    {
        if (! Envelope::shapeIsValid($e)) {
            return 'rejected:shape';
        }
        if (strlen(json_encode($e)) > config('sos.mesh.max_envelope_bytes')) {
            return 'rejected:size';
        }
        if (MeshEnvelope::where('envelope_id', $e['id'])->exists()) {
            return 'duplicate';
        }

        $cert = $e['cert'];
        // Accept certificates that expired while the sender was offline, for up to 7 days.
        if (! $this->signer->verifyCert($cert, graceSeconds: 7 * 86400)) {
            return 'rejected:certificate';
        }
        if ((int) $cert['iid'] !== (int) $e['iid']) {
            return 'rejected:institution_mismatch';
        }
        $sig = base64_decode((string) $e['sig'], true);
        $spk = base64_decode((string) $cert['spk'], true);
        if (! $sig || ! $spk || strlen($sig) !== 64 || strlen($spk) !== 32
            || ! sodium_crypto_sign_verify_detached($sig, Envelope::canonical($e), $spk)) {
            return 'rejected:signature';
        }
        if ((int) $e['exp'] < (int) (microtime(true) * 1000) - 3600_000) {
            return 'rejected:expired';
        }

        $institution = Institution::find((int) $e['iid']);
        $sender = User::find((int) $cert['uid']);
        $device = CurrentInstitution::bypass(fn () => Device::find((int) $cert['did']));
        if (! $institution?->isActive() || ! $sender || $sender->institution_id !== $institution->id
            || ! $device || $device->user_id !== $sender->id || $device->revoked_at || $device->sign_public_key !== $cert['spk']) {
            return 'rejected:unknown_sender';
        }

        [$kind, $toId] = explode(':', $e['to'], 2);
        $record = MeshEnvelope::create([
            'envelope_id' => $e['id'],
            'institution_id' => $institution->id,
            'sender_user_id' => $sender->id,
            'sender_device_id' => $device->id,
            'gateway_user_id' => $gateway?->id,
            'type' => (int) $e['t'],
            'to_kind' => $kind,
            'to_id' => $toId,
            'payload' => $e,
            'expires_at' => now()->addDays(config('sos.retention.mesh_envelopes')),
        ]);

        // Sealed to one device: we can't (and shouldn't) read it. Deliver it to the recipient's phones.
        if ($e['enc'] === 'b') {
            $record->update(['result' => 'sealed_for_recipient', 'processed_at' => now()]);
            if ($kind === 'u') {
                UserSignal::dispatch((int) $toId, 'mesh.sealed', ['envelope_id' => $e['id']]);
            }

            return 'sealed_for_recipient';
        }

        $key = $this->keys->find($institution->id, (string) $e['kid']);
        $payload = $key ? $this->open($e, $key) : null;
        if ($payload === null) {
            $record->update(['result' => 'rejected:decrypt', 'processed_at' => now()]);

            return 'rejected:decrypt';
        }

        try {
            $result = CurrentInstitution::as($institution->id, fn () => $this->materialise((int) $e['t'], $kind, $toId, $payload, $sender));
        } catch (Throwable $ex) {
            report($ex);
            $result = 'rejected:'.class_basename($ex);
        }
        $record->update(['result' => $result, 'processed_at' => now()]);

        return $result;
    }

    private function open(array $e, string $key): ?array
    {
        $nonce = base64_decode((string) $e['n'], true);
        $ct = base64_decode((string) $e['ct'], true);
        if (! $nonce || ! $ct || strlen($nonce) !== SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            return null;
        }
        $json = sodium_crypto_secretbox_open($ct, $nonce, $key);
        $data = $json === false ? null : json_decode($json, true);

        return is_array($data) ? $data : null;
    }

    private function materialise(int $type, string $kind, string $toId, array $p, User $sender): string
    {
        switch ($type) {
            case Envelope::MESSAGE:
                $conversation = $kind === 'c' ? Conversation::find((int) $toId) : null;
                if (! $conversation) {
                    return 'rejected:conversation';
                }
                $this->messages->send($sender, $conversation, [
                    'client_id' => $p['client_id'], 'type' => $p['type'] ?? 'text', 'body' => $p['body'] ?? null,
                    'meta' => $p['meta'] ?? null, 'sent_at' => $p['sent_at'] ?? null,
                    'reply_to_id' => $p['reply_to_id'] ?? null, 'mentions' => is_array($p['mentions'] ?? null) ? $p['mentions'] : [],
                ], 'gateway');

                return 'materialised';

            case Envelope::SOS:
                $this->sos->raise($sender, $p, 'gateway');

                return 'materialised';

            case Envelope::SOS_UPDATE:
                $alert = SosAlert::where('uuid', $p['alert_uuid'] ?? '')->orWhere(fn ($q) => $q
                    ->where('user_id', $p['owner_id'] ?? 0)->where('client_id', $p['alert_client_id'] ?? ''))->first();
                if (! $alert) {
                    return 'rejected:alert';
                }
                $this->sos->respond($alert, $sender, $p['action'] ?? 'note', $p['note'] ?? null, $p['lat'] ?? null, $p['lng'] ?? null);

                return 'materialised';

            case Envelope::SAFETY_RESPONSE:
                $check = SafetyCheck::where('uuid', $p['check_uuid'] ?? '')->first();
                if (! $check) {
                    return 'rejected:check';
                }
                SafetyCheckResponse::updateOrCreate(
                    ['safety_check_id' => $check->id, 'user_id' => $sender->id],
                    ['answer' => ($p['answer'] ?? '') === 'need_help' ? 'need_help' : 'safe', 'note' => $p['note'] ?? null,
                        'lat' => $p['lat'] ?? null, 'lng' => $p['lng'] ?? null, 'via' => 'gateway', 'responded_at' => now()],
                );

                return 'materialised';

            default:
                return 'ignored';
        }
    }
}
