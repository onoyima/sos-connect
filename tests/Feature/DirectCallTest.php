<?php

namespace Tests\Feature;

use App\Models\CallLog;
use App\Models\Conversation;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * One-to-one calls work without the live-update server: the call rings (found by the regular check), the caller
 * learns when it's ringing and when it's answered, and setup messages are collected by polling.
 */
class DirectCallTest extends TestCase
{
    use RefreshDatabase;

    private function pair(): array
    {
        $i = $this->makeInstitution();
        $ada = $this->makeMember($i, ['name' => 'Ada']);
        $ben = $this->makeMember($i, ['name' => 'Ben']);
        CurrentInstitution::as($i->id, fn () => Conversation::create(['type' => 'direct', 'direct_key' => Conversation::directKey($ada->id, $ben->id)]));

        return [$ada, $ben];
    }

    public function test_a_call_rings_is_answered_and_exchanges_setup_messages_without_the_live_server(): void
    {
        [$ada, $ben] = $this->pair();
        $uuid = (string) Str::uuid();

        Sanctum::actingAs($ada);
        $this->postJson('/api/calls', ['callee_id' => $ben->id, 'type' => 'voice', 'call_uuid' => $uuid])->assertCreated();
        $this->getJson("/api/calls/{$uuid}/poll")->assertOk()->assertJsonPath('status', 'ringing')->assertJsonPath('rang', false); // "Calling…"

        // Ben's page finds the call in its regular check, shows it, and says so.
        Sanctum::actingAs($ben);
        $this->getJson('/api/pulse?after=0')->assertJsonPath('incoming_call.call_uuid', $uuid)->assertJsonPath('incoming_call.caller.name', 'Ada');
        $this->postJson("/api/calls/{$uuid}/ringing")->assertOk();

        Sanctum::actingAs($ada);
        $this->getJson("/api/calls/{$uuid}/poll")->assertJsonPath('rang', true); // now "Ringing…"

        Sanctum::actingAs($ben);
        $this->postJson("/api/calls/{$uuid}/state", ['action' => 'answer'])->assertOk()->assertJsonPath('status', 'answered');
        $this->assertNull($this->getJson('/api/pulse?after=0')->json('incoming_call'));

        Sanctum::actingAs($ada);
        $this->getJson("/api/calls/{$uuid}/poll")->assertJsonPath('status', 'answered');
        $sid = $this->postJson("/api/calls/{$uuid}/signal", ['data' => ['sdp' => ['type' => 'offer', 'sdp' => 'v=0']]])->assertOk()->json('sid');

        Sanctum::actingAs($ben);
        $r = $this->getJson("/api/calls/{$uuid}/poll?after=0")->assertOk();
        $this->assertSame('offer', $r->json('signals.0.data.sdp.type'));
        $this->assertSame([], $this->getJson("/api/calls/{$uuid}/poll?after={$sid}")->json('signals'));

        // Stored encrypted, deleted when the call ends.
        $this->assertStringNotContainsString('offer', (string) \DB::table('call_signals')->value('data'));
        $this->postJson("/api/calls/{$uuid}/state", ['action' => 'end'])->assertJsonPath('status', 'ended');
        $this->assertSame(0, \DB::table('call_signals')->count());
    }

    public function test_unanswered_calls_become_missed_and_a_stuck_call_does_not_make_someone_busy(): void
    {
        [$ada, $ben] = $this->pair();
        Sanctum::actingAs($ada);
        $uuid = $this->postJson('/api/calls', ['callee_id' => $ben->id, 'type' => 'voice'])->assertCreated()->json('call_uuid');

        $this->travel(55)->seconds();
        $this->getJson("/api/calls/{$uuid}/poll")->assertJsonPath('status', 'missed');

        // An answered call whose pages were closed without hanging up stops counting after a minute.
        CurrentInstitution::as($ada->institution_id, fn () => CallLog::where('call_uuid', $uuid)->update(['status' => 'answered', 'active_at' => now()->subMinutes(5)]));
        $this->travel(2)->minutes();
        $this->postJson('/api/calls', ['callee_id' => $ben->id, 'type' => 'voice'])->assertCreated();
    }

    public function test_only_the_two_people_in_a_call_can_follow_it(): void
    {
        [$ada, $ben] = $this->pair();
        Sanctum::actingAs($ada);
        $uuid = $this->postJson('/api/calls', ['callee_id' => $ben->id, 'type' => 'video'])->json('call_uuid');

        Sanctum::actingAs($this->makeMember($ada->institution));
        $this->getJson("/api/calls/{$uuid}/poll")->assertForbidden();
        $this->postJson("/api/calls/{$uuid}/signal", ['data' => ['x' => 1]])->assertForbidden();
    }
}
