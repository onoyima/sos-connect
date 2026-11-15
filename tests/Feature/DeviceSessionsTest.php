<?php

namespace Tests\Feature;

use App\Models\WebLink;
use App\Services\Auth\DeviceSessions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** One phone and one web browser per account; the phone links the browser with a QR code (not for admins). */
class DeviceSessionsTest extends TestCase
{
    use RefreshDatabase;

    public function test_signing_in_on_another_phone_signs_the_old_phone_out_and_says_why(): void
    {
        $member = $this->makeMember($this->makeInstitution());
        $old = $member->createToken('phone');
        $new = $member->createToken('phone');

        DeviceSessions::claimPhone($member, $new->accessToken->id);

        $this->assertSame(1, $member->tokens()->count());
        $this->withToken($old->plainTextToken)->getJson('/api/me')
            ->assertStatus(401)->assertJsonPath('signed_out', 'replaced');
    }

    public function test_only_the_latest_browser_stays_signed_in(): void
    {
        $member = $this->makeMember($this->makeInstitution());

        // Never signed in on the website through the new rules: nothing changes.
        $this->actingAs($member)->getJson('/session')->assertOk();

        // Another browser has signed in since.
        $member->forceFill(['web_session_id' => 'another-browser'])->save();
        $this->actingAs($member)->getJson('/session')->assertStatus(401)->assertJsonPath('signed_out', 'replaced');
        $this->assertGuest('web');

        $member->forceFill(['web_session_id' => 'another-browser'])->save();
        $this->actingAs($member)->get('/session')->assertRedirect('/login?replaced=1');

        // Signed out from the phone.
        $member->forceFill(['web_session_id' => DeviceSessions::REVOKED])->save();
        $this->actingAs($member)->get('/session')->assertRedirect('/login?phone=1');
    }

    public function test_phone_approves_a_browser_code_but_admins_cannot_link(): void
    {
        $i = $this->makeInstitution();
        $member = $this->makeMember($i);
        $admin = $this->makeMember($i, ['member_type' => 'admin']);
        $link = WebLink::create(['code' => str_repeat('a', 48), 'browser' => 'x', 'agent' => 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', 'expires_at' => now()->addMinute()]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/linked-devices/web', ['code' => 'sos-link:'.$link->code])->assertForbidden();
        $this->getJson('/api/linked-devices')->assertJsonPath('can_link', false);

        Sanctum::actingAs($member);
        $this->postJson('/api/linked-devices/web', ['code' => 'sos-link:'.$link->code])->assertOk()->assertJsonPath('browser', 'Chrome on Windows');
        $this->assertSame('approved', $link->fresh()->status);
        $this->assertSame($member->id, $link->fresh()->user_id);

        // A code can only be used once, and old codes don't work.
        $this->postJson('/api/linked-devices/web', ['code' => $link->code])->assertStatus(422);
        $old = WebLink::create(['code' => str_repeat('b', 48), 'browser' => 'x', 'expires_at' => now()->subSecond()]);
        $this->postJson('/api/linked-devices/web', ['code' => $old->code])->assertStatus(422);
    }

    public function test_the_browser_that_showed_the_code_is_signed_in_once_the_phone_approves(): void
    {
        $member = $this->makeMember($this->makeInstitution());

        ['code' => $code, 'key' => $key] = $this->postJson('/link')->assertOk()->json();

        // Another browser (without the page's secret key) can't use someone else's code.
        $this->getJson("/link/{$code}")->assertJsonPath('status', 'expired');
        $this->getJson("/link/{$code}", ['X-Link-Key' => 'not-the-key'])->assertJsonPath('status', 'expired');

        $this->getJson("/link/{$code}", ['X-Link-Key' => $key])->assertJsonPath('status', 'pending');

        WebLink::where('code', $code)->update(['user_id' => $member->id, 'status' => 'approved', 'approved_at' => now()]);
        $this->getJson("/link/{$code}", ['X-Link-Key' => $key])->assertJsonPath('status', 'linked');

        $this->assertAuthenticatedAs($member, 'web');
        $this->assertSame('qr', $member->fresh()->web_session_via);
        $this->assertSame('used', WebLink::where('code', $code)->value('status'));
    }

    public function test_a_browser_linked_from_the_phone_is_signed_out_with_the_phone(): void
    {
        $member = $this->makeMember($this->makeInstitution());
        $member->forceFill(['web_session_id' => 'browser-1', 'web_session_via' => 'qr', 'web_session_at' => now()])->save();
        $token = $member->createToken('phone');

        $this->withToken($token->plainTextToken)->getJson('/api/linked-devices')->assertJsonPath('web.via', 'qr');
        $this->withToken($token->plainTextToken)->postJson('/api/auth/logout')->assertOk();

        $this->assertSame(DeviceSessions::REVOKED, $member->fresh()->web_session_id);
    }
}
