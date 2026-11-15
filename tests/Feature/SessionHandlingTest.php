<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;
use Tests\TestCase;

/** Nobody gets stuck on an expired or broken page: there is always a way back. */
class SessionHandlingTest extends TestCase
{
    use RefreshDatabase;

    public function test_signed_out_visitors_go_to_sign_in(): void
    {
        $this->get('/chats')->assertRedirect('/login');
    }

    public function test_expired_page_signs_out_and_returns_to_sign_in_with_a_message(): void
    {
        Route::middleware('web')->post('/_expired', fn () => throw new TokenMismatchException('CSRF token mismatch.'));
        $member = $this->makeMember($this->makeInstitution());

        $this->actingAs($member)->post('/_expired')
            ->assertRedirect('/login')
            ->assertSessionHas('error');
        $this->assertGuest();
    }

    public function test_apps_get_json_not_a_redirect_when_the_session_has_ended(): void
    {
        $this->getJson('/api/me')->assertStatus(401)->assertJsonPath('session_expired', true);
    }

    public function test_missing_pages_get_a_friendly_page_with_a_way_out(): void
    {
        $this->get('/this-page-does-not-exist')->assertNotFound()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Error')->where('status', 404));
    }

    public function test_signed_in_pages_are_never_cached_by_the_browser(): void
    {
        $member = $this->makeMember($this->makeInstitution());
        $res = $this->actingAs($member)->get('/session')->assertOk();
        $this->assertStringContainsString('no-store', (string) $res->headers->get('Cache-Control'));
    }
}
