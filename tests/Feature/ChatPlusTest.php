<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Message;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Profiles with WhatsApp, sound choices, forwarding, the 15-minute delete rule, and alumni posting status. */
class ChatPlusTest extends TestCase
{
    use RefreshDatabase;

    private function group(array $members, string $name = 'Team'): Conversation
    {
        return CurrentInstitution::as($members[0]->institution_id, function () use ($members, $name) {
            $c = Conversation::create(['type' => 'group', 'name' => $name]);
            foreach ($members as $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'role' => 'member', 'joined_at' => now()]);
            }

            return $c;
        });
    }

    public function test_profile_shows_whatsapp_and_my_own_number_never_replaces_the_school_one(): void
    {
        $i = $this->makeInstitution();
        $ada = $this->makeMember($i, ['phone' => '0803 000 0000']);
        $ben = $this->makeMember($i);

        Sanctum::actingAs($ben);
        $this->getJson("/api/people/{$ada->id}")->assertOk()->assertJsonPath('person.whatsapp', '2348030000000');

        Sanctum::actingAs($ada);
        $this->patchJson('/api/me/contact', ['whatsapp' => '+234 905 111 2222', 'show_whatsapp' => true])->assertOk()
            ->assertJsonPath('contact.school_phone', '+234 803 000 0000');
        $this->assertSame('0803 000 0000', $ada->fresh()->phone); // the school's record is untouched

        Sanctum::actingAs($ben);
        $this->getJson("/api/people/{$ada->id}")->assertJsonPath('person.whatsapp', '2349051112222');

        Sanctum::actingAs($ada);
        $this->patchJson('/api/me/contact', ['whatsapp' => null, 'show_whatsapp' => false])->assertOk();
        Sanctum::actingAs($ben);
        $this->assertNull($this->getJson("/api/people/{$ada->id}")->json('person.whatsapp'));
    }

    public function test_sound_choices_are_saved_and_checked(): void
    {
        $i = $this->makeInstitution();
        Sanctum::actingAs($this->makeMember($i));
        $this->getJson('/api/me/sounds')->assertOk()->assertJsonPath('sounds.message', 'chime');
        $this->putJson('/api/me/sounds', ['sounds' => ['message' => 'bell', 'call' => 'soft']])->assertOk()
            ->assertJsonPath('sounds.message', 'bell')->assertJsonPath('sounds.call', 'soft');
        $this->putJson('/api/me/sounds', ['sounds' => ['call' => 'chime']])->assertStatus(422); // a message tone isn't a ringtone
    }

    public function test_forwarding_and_the_fifteen_minute_delete_rule(): void
    {
        $i = $this->makeInstitution();
        $ada = $this->makeMember($i);
        $ben = $this->makeMember($i);
        $one = $this->group([$ada, $ben], 'One');
        $two = $this->group([$ada, $ben], 'Two');
        $outside = $this->group([$ben], 'Not mine');

        Sanctum::actingAs($ada);
        $id = $this->postJson("/api/conversations/{$one->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => 'Exam moved'])
            ->assertCreated()->json('message.id');
        $r = $this->postJson("/api/messages/{$id}/forward", ['conversation_ids' => [$two->id, $outside->id]])->assertOk();
        $this->assertCount(1, $r->json('sent'));
        $this->assertCount(1, $r->json('failed'));
        $this->assertTrue($r->json('sent.0.message.meta.forwarded'));

        // Own message: deletable for everyone within 15 minutes, not after.
        $this->travel(16)->minutes();
        $this->deleteJson("/api/messages/{$id}")->assertStatus(422);
        $this->travelBack();
        $this->deleteJson("/api/messages/{$id}")->assertOk();
        $this->assertTrue(CurrentInstitution::as($i->id, fn () => Message::withTrashed()->find($id)->trashed()));
    }

    public function test_alumni_can_post_status(): void
    {
        $i = $this->makeInstitution();
        $grad = $this->makeMember($i, ['member_type' => 'alumni']);
        app(\App\Services\Access\RoleManager::class)->installDefaults($i);
        \App\Support\Access::forget();
        $this->assertTrue(\App\Support\Access::can($grad, 'status.post'));
    }
}
