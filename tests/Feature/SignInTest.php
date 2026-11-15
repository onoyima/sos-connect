<?php

namespace Tests\Feature;

use App\Services\Auth\SignIn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The sign-in page must not reveal which institutions use the service. */
class SignInTest extends TestCase
{
    use RefreshDatabase;

    public function test_there_is_no_public_institution_search(): void
    {
        $this->makeInstitution();
        $this->postJson('/api/auth/institutions', ['q' => 'University'])->assertNotFound();
        $this->get('/login')->assertOk()->assertDontSee('University ABC');
    }

    public function test_unrecognised_details_get_the_same_answer_and_reach_no_school(): void
    {
        $this->makeInstitution('ABC');
        $this->makeInstitution('XYZ');
        Http::fake();

        $res = $this->postJson('/api/auth/login', ['identifier' => 'someone@elsewhere.test', 'password' => 'x']);
        $res->assertStatus(422)->assertJsonPath('message', SignIn::FAILED);
        Http::assertNothingSent(); // the password went nowhere
    }

    public function test_school_is_found_from_email_domain_or_id_format(): void
    {
        $abc = $this->makeInstitution('ABC');
        $xyz = $this->makeInstitution('XYZ');
        $abc->update(['email_domains' => ['abc.test']]);
        $xyz->update(['settings' => array_merge($xyz->settings, ['login_patterns' => ['XYZ/*/##/####']])]);
        Http::fake([
            'connector.abc.test/*' => $this->connectorResponse(['ok' => false, 'reason' => 'invalid_credentials']),
            'connector.xyz.test/*' => $this->connectorResponse(['ok' => false, 'reason' => 'invalid_credentials']),
        ]);

        $this->postJson('/api/auth/login', ['identifier' => 'ada@student.abc.test', 'password' => 'x'])->assertStatus(422);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'connector.abc.test'));
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'connector.xyz.test'));

        $this->postJson('/api/auth/login', ['identifier' => 'xyz/csc/21/0042', 'password' => 'x'])->assertStatus(422);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'connector.xyz.test'));
    }

    public function test_id_formats(): void
    {
        $this->assertTrue(SignIn::matches('ABC/*/##/####', 'abc/phe/24/0142'));
        $this->assertFalse(SignIn::matches('ABC/*/##/####', 'ABC/PHE/24/01X2'));
        $this->assertFalse(SignIn::matches('', 'anything'));
    }

    public function test_platform_operator_signs_in_with_the_same_form(): void
    {
        $op = \App\Models\User::forceCreate(['email' => 'ops@service.test', 'name' => 'Ops', 'auth_source' => 'local', 'member_type' => 'admin',
            'password' => 'a-long-password', 'status' => 'active', 'is_platform_admin' => true]);
        $this->post('/login', ['identifier' => 'ops@service.test', 'password' => 'a-long-password'])->assertRedirect(route('platform.institutions'));
        $this->assertAuthenticatedAs($op);
    }
}
