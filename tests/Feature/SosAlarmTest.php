<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** SOS rings an alarm for every responder (even without live updates), counts, and stops for others once someone responds. */
class SosAlarmTest extends TestCase
{
    use RefreshDatabase;

    private function signals(): array
    {
        return $this->getJson('/api/pulse?after=0')->assertOk()->json('signals');
    }

    public function test_responders_are_alarmed_counted_and_released(): void
    {
        $school = $this->makeInstitution();
        $student = $this->makeMember($school, ['name' => 'Ada Obi', 'phone' => '08030000000']);
        $guard = $this->makeMember($school, ['member_type' => 'staff', 'name' => 'Guard One']);
        $this->giveRole($guard, 'security');
        $guard2 = $this->makeMember($school, ['member_type' => 'staff', 'name' => 'Guard Two']);
        $this->giveRole($guard2, 'security');

        Sanctum::actingAs($student);
        $id = $this->postJson('/api/sos', ['client_id' => (string) Str::uuid(), 'category' => 'medical', 'location_label' => 'Block C'])
            ->assertCreated()->json('alert.id');

        // Each responder gets the alarm with who and where (from the regular check, so it works without the websocket).
        Sanctum::actingAs($guard);
        $alarm = collect($this->signals())->firstWhere('kind', 'sos.alarm');
        $this->assertNotNull($alarm);
        $this->assertSame($id, $alarm['data']['id']);
        $this->assertSame('Ada Obi', $alarm['data']['user']['name']);
        $this->assertSame('Block C', $alarm['data']['location_label']);
        $this->getJson('/api/badges')->assertJsonPath('badges.sos', 1);

        // The person who pressed SOS is not alarmed by their own alert.
        Sanctum::actingAs($student);
        $this->assertNull(collect($this->signals())->firstWhere('kind', 'sos.alarm'));

        // One guard responds: the other guard's alarm is told to stop, and who is on it.
        Sanctum::actingAs($guard);
        $this->postJson("/api/sos/{$id}/respond", ['action' => 'acknowledged'])->assertOk();
        Sanctum::actingAs($guard2);
        $update = collect($this->signals())->firstWhere('kind', 'sos.update');
        $this->assertSame('acknowledged', $update['data']['status']);
        $this->assertSame('Guard One', $update['data']['by']);

        // Resolved: no longer counted.
        Sanctum::actingAs($guard);
        $this->postJson("/api/sos/{$id}/respond", ['action' => 'resolved'])->assertOk();
        $this->getJson('/api/badges')->assertJsonPath('badges.sos', 0);
    }
}
