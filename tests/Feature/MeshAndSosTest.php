<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Device;
use App\Models\Message;
use App\Models\SosAlert;
use App\Services\Mesh\Envelope;
use App\Services\Mesh\MeshKeyring;
use App\Services\Mesh\PlatformSigner;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MeshAndSosTest extends TestCase
{
    use RefreshDatabase;

    /** Builds an envelope exactly like the phone does (mobile/src/mesh/protocol.ts). */
    private function envelope(array $cert, string $signSecret, int $iid, int $type, string $to, array $payload, string $kid, string $key): array
    {
        $nonce = random_bytes(24);
        $e = ['v' => 1, 'id' => bin2hex(random_bytes(16)), 'iid' => $iid, 't' => $type, 'to' => $to,
            'ts' => (int) (microtime(true) * 1000), 'exp' => (int) (microtime(true) * 1000) + 3600_000, 'hop' => 8,
            'enc' => 'k', 'kid' => $kid, 'n' => base64_encode($nonce),
            'ct' => base64_encode(sodium_crypto_secretbox(json_encode($payload), $nonce, $key)), 'cert' => $cert];
        $e['sig'] = base64_encode(sodium_crypto_sign_detached(Envelope::canonical($e), $signSecret));

        return $e;
    }

    private function phone($user): array
    {
        $sign = sodium_crypto_sign_keypair();
        $device = CurrentInstitution::as($user->institution_id, fn () => Device::create(['user_id' => $user->id, 'institution_id' => $user->institution_id,
            'device_uid' => Str::random(10), 'platform' => 'android', 'sign_public_key' => base64_encode(sodium_crypto_sign_publickey($sign)),
            'box_public_key' => base64_encode(random_bytes(32))]));

        return [app(PlatformSigner::class)->issue($user, $device), sodium_crypto_sign_secretkey($sign)];
    }

    public function test_offline_message_carried_by_a_gateway_from_another_institution_is_delivered_once(): void
    {
        $school = $this->makeInstitution('ABC');
        $other = $this->makeInstitution('OTH');
        $sender = $this->makeMember($school);
        $gateway = $this->makeMember($other); // a stranger's phone that happened to have internet

        $conversation = CurrentInstitution::as($school->id, fn () => Conversation::create(['type' => 'group', 'name' => 'Hostel B']));
        ConversationMember::create(['conversation_id' => $conversation->id, 'user_id' => $sender->id]);

        [$cert, $sk] = $this->phone($sender);
        $mk = app(MeshKeyring::class)->current($school->id);
        $clientId = (string) Str::uuid();
        $env = $this->envelope($cert, $sk, $school->id, Envelope::MESSAGE, "c:{$conversation->id}",
            ['client_id' => $clientId, 'type' => 'text', 'body' => 'Power is out in Hostel B'], $mk->key_id, base64_decode($mk->secret));

        Sanctum::actingAs($gateway);
        $this->postJson('/api/mesh/relay', ['envelopes' => [$env]])->assertOk()->assertJsonPath("results.{$env['id']}", 'materialised');
        $this->postJson('/api/mesh/relay', ['envelopes' => [$env]])->assertJsonPath("results.{$env['id']}", 'duplicate');

        // The sender later reconnects and flushes the same message from their own outbox: still one row.
        Sanctum::actingAs($sender);
        $this->postJson('/api/sync', ['messages' => [['conversation_id' => $conversation->id, 'client_id' => $clientId, 'type' => 'text', 'body' => 'Power is out in Hostel B']]])->assertOk();

        $this->assertSame(1, CurrentInstitution::bypass(fn () => Message::where('client_id', $clientId)->count()));
    }

    public function test_tampered_envelope_is_rejected(): void
    {
        $school = $this->makeInstitution();
        $sender = $this->makeMember($school);
        [$cert, $sk] = $this->phone($sender);
        $mk = app(MeshKeyring::class)->current($school->id);
        $env = $this->envelope($cert, $sk, $school->id, Envelope::SOS, "i:{$school->id}", ['client_id' => (string) Str::uuid(), 'category' => 'fire'], $mk->key_id, base64_decode($mk->secret));
        $env['to'] = 'i:999';

        Sanctum::actingAs($sender);
        $this->postJson('/api/mesh/relay', ['envelopes' => [$env]])->assertJsonPath("results.{$env['id']}", 'rejected:signature');
    }

    public function test_sos_online_is_idempotent_and_responders_can_acknowledge(): void
    {
        $school = $this->makeInstitution();
        $student = $this->makeMember($school);
        $guard = $this->makeMember($school, ['member_type' => 'staff']);
        $this->giveRole($guard, 'security');
        $payload = ['client_id' => (string) Str::uuid(), 'category' => 'medical', 'lat' => 7.7, 'lng' => 8.5, 'accuracy_m' => 30];

        Sanctum::actingAs($student);
        $uuid = $this->postJson('/api/sos', $payload)->assertCreated()->json('alert.uuid');
        $this->postJson('/api/sos', $payload)->assertCreated();
        $this->assertSame(1, CurrentInstitution::bypass(fn () => SosAlert::count()));

        $alert = CurrentInstitution::bypass(fn () => SosAlert::where('uuid', $uuid)->first());
        $this->postJson("/api/sos/{$alert->id}/respond", ['action' => 'resolved'])->assertForbidden();

        Sanctum::actingAs($guard);
        $this->postJson("/api/sos/{$alert->id}/respond", ['action' => 'on_my_way'])->assertOk()->assertJsonPath('alert.status', 'responding');
    }
}
