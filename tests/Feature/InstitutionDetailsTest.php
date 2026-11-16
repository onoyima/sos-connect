<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\CallController;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InstitutionDetailsTest extends TestCase
{
    use RefreshDatabase;

    public function test_institution_admins_edit_their_details_and_others_cannot(): void
    {
        $i = $this->makeInstitution('ABC');
        $this->makeInstitution('XYZ');
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $student = $this->makeMember($i);

        $this->actingAs($admin)->post('/admin/settings/details', ['name' => 'University of Somewhere', 'short_code' => 'uos',
            'contact_name' => 'ICT Unit', 'contact_email' => 'ict@uos.school.test'])->assertSessionHasNoErrors();
        $i->refresh();
        $this->assertSame('University of Somewhere', $i->name);
        $this->assertSame('UOS', $i->short_code);

        // Another school's short name can't be taken.
        $this->actingAs($admin)->post('/admin/settings/details', ['name' => 'University of Somewhere', 'short_code' => 'XYZ',
            'contact_name' => 'ICT Unit', 'contact_email' => 'ict@uos.school.test'])->assertSessionHasErrors('short_code');

        $this->actingAs($student)->post('/admin/settings/details', ['name' => 'Hacked', 'short_code' => 'HCK',
            'contact_name' => 'x', 'contact_email' => 'x@x.test'])->assertForbidden();
        $this->assertSame('University of Somewhere', $i->fresh()->name);
    }

    public function test_call_relay_settings(): void
    {
        config(['sos.calls.turn_host' => null, 'sos.calls.turn_urls' => null]);
        $this->assertCount(1, CallController::servers(5)); // STUN only

        config(['sos.calls.turn_host' => 'turn.school.test', 'sos.calls.turn_secret' => 's3cret', 'sos.calls.turn_tls' => false]);
        $s = CallController::servers(5);
        $turn = collect($s)->firstWhere('username');
        $this->assertNotNull($turn);
        $this->assertStringEndsWith(':5', $turn['username']);
        $this->assertNotContains('turns:turn.school.test:5349?transport=tcp', $turn['urls']);

        config(['sos.calls.turn_host' => null, 'sos.calls.turn_urls' => 'turn:a.test:3478, turn:a.test:443?transport=tcp', 'sos.calls.turn_username' => 'u', 'sos.calls.turn_password' => 'p']);
        $hosted = collect(CallController::servers(5))->firstWhere('username', 'u');
        $this->assertSame(['turn:a.test:3478', 'turn:a.test:443?transport=tcp'], $hosted['urls']);
    }
}
