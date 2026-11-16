<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Support\CurrentInstitution;
use App\Support\SafeUrl;
use App\Support\Sealed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Encryption at rest, brute-force limits, access between schools and chats, security headers, SSRF. */
class SecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_phone_numbers_are_encrypted_in_the_database_but_still_findable(): void
    {
        $i = $this->makeInstitution();
        $u = $this->makeMember($i, ['phone' => '0803 123 4567']);

        $raw = DB::table('users')->where('id', $u->id)->value('phone');
        $this->assertNotSame('0803 123 4567', $raw);
        $this->assertStringNotContainsString('0803', $raw);
        $this->assertSame('0803 123 4567', $u->fresh()->phone);
        $this->assertSame(Sealed::phoneIndex('+234 803 123 4567'), $u->fresh()->phone_index); // same number, other format
        $this->assertArrayNotHasKey('phone_index', $u->fresh()->toArray());
    }

    public function test_one_account_is_locked_after_many_wrong_passwords_even_from_many_addresses(): void
    {
        // Outside production nobody is ever blocked (RelaxedRateLimiter); this test checks the production limiter.
        $this->app->instance(\Illuminate\Cache\RateLimiter::class, new \Illuminate\Cache\RateLimiter($this->app->make('cache')->driver('array')));
        \Illuminate\Support\Facades\RateLimiter::clearResolvedInstances();

        $this->makeInstitution();
        $limit = (int) config('sos.security.login_per_account');
        for ($n = 1; $n <= $limit; $n++) {
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.{$n}"])
                ->postJson('/api/auth/login', ['identifier' => 'ABC/CSC/21/0001', 'password' => "guess{$n}"])->assertStatus(422);
        }
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
            ->postJson('/api/auth/login', ['identifier' => 'ABC/CSC/21/0001', 'password' => 'another'])->assertStatus(429);
    }

    public function test_people_and_chats_of_another_school_or_chat_cannot_be_read(): void
    {
        $a = $this->makeInstitution('AAA');
        $b = $this->makeInstitution('BBB');
        $ada = $this->makeMember($a);
        $ben = $this->makeMember($a);
        $outsider = $this->makeMember($b);
        $chat = CurrentInstitution::as($a->id, function () use ($ada, $ben) {
            $c = Conversation::create(['type' => 'group', 'name' => 'Private']);
            foreach ([$ada, $ben] as $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'role' => 'member', 'joined_at' => now()]);
            }

            return $c;
        });

        Sanctum::actingAs($outsider);
        $this->getJson("/api/people/{$ada->id}")->assertNotFound();
        $this->assertContains($this->getJson("/api/conversations/{$chat->id}/messages")->status(), [403, 404]);

        $carl = $this->makeMember($a); // same school, not in the chat
        Sanctum::actingAs($carl);
        $this->assertContains($this->getJson("/api/conversations/{$chat->id}/messages")->status(), [403, 404]);
    }

    public function test_pages_carry_security_headers(): void
    {
        $this->withoutVite();
        $res = $this->get('/login');
        $res->assertHeader('X-Frame-Options', 'DENY')->assertHeader('X-Content-Type-Options', 'nosniff');
        $csp = (string) $res->headers->get('Content-Security-Policy');
        $this->assertStringContainsString("frame-ancestors 'none'", $csp);
        $this->assertMatchesRegularExpression("/script-src 'self' 'nonce-[A-Za-z0-9+\\/=]+'/", $csp);
        $this->assertStringNotContainsString("'unsafe-eval'", $csp);
        $this->assertFalse($res->headers->has('X-Powered-By'));
    }

    public function test_the_server_refuses_to_call_private_addresses(): void
    {
        foreach (['https://127.0.0.1/v1', 'https://10.0.0.5', 'https://169.254.169.254/latest', 'https://[::1]/', 'ftp://example.com', 'https://user:pw@example.com'] as $url) {
            $this->assertNotNull(SafeUrl::problem($url), $url);
        }
        $this->assertNull(SafeUrl::problem('https://8.8.8.8/v1'));
    }
}
