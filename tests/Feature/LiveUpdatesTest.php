<?php

namespace Tests\Feature;

use App\Events\UserSignal;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Support\CurrentInstitution;
use App\Support\Realtime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Pages and phones that can't reach the websocket server still get changes and call signals. */
class LiveUpdatesTest extends TestCase
{
    use RefreshDatabase;

    public function test_signals_wait_for_people_who_check_instead_of_listening(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];

        Sanctum::actingAs($bayo);
        $cursor = $this->getJson('/api/pulse')->assertOk()->assertJsonCount(0, 'signals')->json('cursor');

        UserSignal::dispatch($bayo->id, 'call.incoming', ['call_uuid' => 'abc', 'type' => 'voice', 'caller' => ['id' => $ada->id, 'name' => 'Ada']]);
        UserSignal::dispatch($ada->id, 'call.state', ['call_uuid' => 'abc', 'status' => 'answered']); // not for Bayo

        $r = $this->getJson("/api/pulse?after={$cursor}")->assertOk()->assertJsonCount(1, 'signals')
            ->assertJsonPath('signals.0.kind', 'call.incoming')->assertJsonPath('signals.0.data.call_uuid', 'abc');
        $this->getJson('/api/pulse?after='.$r->json('cursor'))->assertJsonCount(0, 'signals'); // each one once
    }

    public function test_stamps_change_when_something_new_arrives(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, function () use ($ada, $bayo) {
            $c = Conversation::create(['type' => 'group', 'name' => 'Team']);
            foreach ([$ada, $bayo] as $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'joined_at' => now()]);
            }

            return $c;
        });

        Sanctum::actingAs($bayo);
        $before = $this->getJson('/api/pulse')->json('stamps');

        Sanctum::actingAs($ada);
        $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => 'hi'])->assertCreated();
        $this->postJson('/api/sos', ['client_id' => (string) Str::uuid(), 'category' => 'medical'])->assertSuccessful();

        Sanctum::actingAs($bayo);
        $after = $this->getJson('/api/pulse')->json('stamps');
        $this->assertNotSame($before['messages'], $after['messages']);
        $this->assertNotSame($before['sos'], $after['sos']);
        $this->assertSame($before['announcements'], $after['announcements']);
    }

    public function test_connection_details_are_given_only_when_live_updates_are_on(): void
    {
        $i = $this->makeInstitution();
        Sanctum::actingAs($this->makeMember($i));
        $this->getJson('/api/realtime')->assertJsonPath('realtime', null);

        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'k123',
            'broadcasting.connections.reverb.options.host' => '127.0.0.1', 'broadcasting.connections.reverb.options.port' => 8080,
            'broadcasting.connections.reverb.options.scheme' => 'http']);
        // A local address means "the same address the page or app already uses".
        $this->getJson('/api/realtime')->assertJsonPath('realtime.key', 'k123')->assertJsonPath('realtime.host', null)->assertJsonPath('realtime.port', 8080);
        $this->assertSame('k123', Realtime::clientSettings()['key']);
    }
}
