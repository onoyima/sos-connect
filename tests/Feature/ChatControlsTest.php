<?php

namespace Tests\Feature;

use App\Services\Chat\DirectChats;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Mute for a while, archive, pause; answers to chat requests; roles never shown to others. */
class ChatControlsTest extends TestCase
{
    use RefreshDatabase;

    private function say($c, string $text): int
    {
        return $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => $text])->assertCreated()->json('message.id');
    }

    public function test_pause_holds_messages_back_until_resumed_and_archive_moves_the_chat(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, fn () => DirectChats::open($ada, $bayo, accepted: true));

        Sanctum::actingAs($ada);
        $this->say($c, 'before');
        Sanctum::actingAs($bayo);
        $this->patchJson("/api/conversations/{$c->id}", ['paused' => true])->assertOk();

        Sanctum::actingAs($ada);
        $this->say($c, 'while paused');

        Sanctum::actingAs($bayo);
        $this->assertSame(['before'], array_column($this->getJson("/api/conversations/{$c->id}/messages")->json('messages'), 'body'));
        $this->getJson('/api/badges')->assertJsonPath('badges.chats', 0);
        $this->getJson('/api/conversations')->assertJsonPath('conversations.0.last_message.body', 'before');

        $this->patchJson("/api/conversations/{$c->id}", ['paused' => false])->assertOk();
        $this->assertSame(['before', 'while paused'], array_column($this->getJson("/api/conversations/{$c->id}/messages")->json('messages'), 'body'));
        $this->getJson('/api/badges')->assertJsonPath('badges.chats', 1);

        $this->patchJson("/api/conversations/{$c->id}", ['archived' => true])->assertOk();
        $this->getJson('/api/conversations')->assertJsonPath('conversations.0.archived', true);
        $this->getJson('/api/badges')->assertJsonPath('badges.chats', 0); // archived chats don't add to the red count

        $this->patchJson("/api/conversations/{$c->id}", ['muted' => true, 'mute_hours' => 8])->assertOk();
        $this->getJson('/api/conversations')->assertJsonPath('conversations.0.muted', true)
            ->assertJsonPath('conversations.0.muted_until', fn ($v) => $v !== null);
    }

    public function test_the_institution_can_switch_the_controls_off(): void
    {
        $i = $this->makeInstitution();
        $i->update(['settings' => array_merge($i->settings ?? [], ['modules' => ['pause_chats' => false, 'archive_chats' => false]])]);
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, fn () => DirectChats::open($ada, $bayo, accepted: true));

        Sanctum::actingAs($ada);
        $this->patchJson("/api/conversations/{$c->id}", ['paused' => true])->assertForbidden();
        $this->patchJson("/api/conversations/{$c->id}", ['archived' => true])->assertForbidden();
        $this->patchJson("/api/conversations/{$c->id}", ['muted' => true])->assertOk();
    }

    public function test_the_sender_sees_the_answer_to_a_request(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i, ['name' => 'Ada']), $this->makeMember($i, ['name' => 'Bayo'])];

        Sanctum::actingAs($ada);
        $id = $this->postJson('/api/chat-requests', ['user_id' => $bayo->id])->assertCreated()->json('request.id');
        Sanctum::actingAs($bayo);
        $this->postJson("/api/chat-requests/{$id}/decline")->assertOk();

        Sanctum::actingAs($ada);
        $this->getJson('/api/chat-requests')->assertJsonPath('responses.0.status', 'declined')->assertJsonPath('responses.0.person.name', 'Bayo');
        $this->getJson('/api/badges')->assertJsonPath('badges.requests', 1);
        $this->postJson('/api/chat-requests/responses/seen')->assertOk();
        $this->getJson('/api/chat-requests')->assertJsonCount(0, 'responses');
        $this->getJson('/api/badges')->assertJsonPath('badges.requests', 0);
    }

    public function test_roles_are_only_shown_to_the_person_who_has_them(): void
    {
        $i = $this->makeInstitution();
        $hod = $this->makeMember($i, ['member_type' => 'staff', 'name' => 'Dr Hod', 'title' => 'Head of department, Physics']);
        $student = $this->makeMember($i);

        Sanctum::actingAs($student);
        $this->getJson('/api/directory?q=Hod')->assertJsonPath('people.0.name', 'Dr Hod')->assertJsonMissingPath('people.0.title');
        Sanctum::actingAs($hod);
        $this->getJson('/api/me')->assertJsonPath('user.title', 'Head of department, Physics');
    }
}
