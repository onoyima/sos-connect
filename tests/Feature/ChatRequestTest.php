<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\Message;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Who can chat (and call) straight away, and who has to ask first. */
class ChatRequestTest extends TestCase
{
    use RefreshDatabase;

    private function direct(\App\Models\User $to): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/conversations/direct', ['user_id' => $to->id]);
    }

    public function test_student_to_student_needs_a_request_and_opens_when_accepted(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i, ['name' => 'Ada']), $this->makeMember($i, ['name' => 'Bayo'])];

        Sanctum::actingAs($ada);
        $this->direct($bayo)->assertForbidden()->assertJsonPath('needs_request', true);
        $this->postJson('/api/calls', ['callee_id' => $bayo->id, 'type' => 'voice'])->assertForbidden(); // calls follow the same rule
        $this->getJson('/api/directory?q=Bayo')->assertJsonPath('people.0.reach', 'request');

        $id = $this->postJson('/api/chat-requests', ['user_id' => $bayo->id, 'message' => 'Hi, same class!'])->assertCreated()->json('request.id');
        $this->getJson('/api/directory?q=Bayo')->assertJsonPath('people.0.reach', 'requested');

        Sanctum::actingAs($bayo);
        $this->getJson('/api/chat-requests')->assertJsonPath('incoming.0.person.name', 'Ada')->assertJsonPath('incoming.0.message', 'Hi, same class!');
        $this->getJson('/api/directory?q=Ada')->assertJsonPath('people.0.reach', 'accept');
        $cid = $this->postJson("/api/chat-requests/{$id}/accept")->assertOk()->json('conversation_id');

        // The note is the first message, and both can now chat and call either way.
        $first = CurrentInstitution::as($i->id, fn () => Message::where('conversation_id', $cid)->first());
        $this->assertSame('Hi, same class!', $first->body);
        $this->assertSame($ada->id, $first->sender_id);
        $this->direct($ada)->assertCreated()->assertJsonPath('conversation_id', $cid);
        Sanctum::actingAs($ada);
        $this->postJson('/api/calls', ['callee_id' => $bayo->id, 'type' => 'voice'])->assertCreated();
    }

    public function test_declined_requests_cant_be_repeated_straight_away(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        Sanctum::actingAs($ada);
        $id = $this->postJson('/api/chat-requests', ['user_id' => $bayo->id])->json('request.id');
        Sanctum::actingAs($bayo);
        $this->postJson("/api/chat-requests/{$id}/decline")->assertOk();
        Sanctum::actingAs($ada);
        $this->postJson('/api/chat-requests', ['user_id' => $bayo->id])->assertStatus(429);
        $this->direct($bayo)->assertForbidden();
    }

    public function test_asking_someone_who_already_asked_you_opens_the_chat(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        Sanctum::actingAs($ada);
        $this->postJson('/api/chat-requests', ['user_id' => $bayo->id])->assertCreated();
        Sanctum::actingAs($bayo);
        $this->postJson('/api/chat-requests', ['user_id' => $ada->id])->assertOk()->assertJsonPath('status', 'accepted');
    }

    public function test_staff_rules(): void
    {
        $i = $this->makeInstitution();
        $physics = $this->makeUnit($i, 'department', 'Physics');
        $law = $this->makeUnit($i, 'department', 'Law');
        $lecturer = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id]);
        $colleague = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id]);
        $elsewhere = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $law->id]);
        $student = $this->makeMember($i, ['department_unit_id' => $law->id]);

        Sanctum::actingAs($lecturer);
        $this->direct($student)->assertCreated();          // staff -> any student
        $this->direct($colleague)->assertCreated();        // same department
        $this->direct($elsewhere)->assertForbidden()->assertJsonPath('needs_request', true); // another department

        // The student can now reply in the chat the lecturer opened, but can't start one with other staff.
        Sanctum::actingAs($student);
        $this->direct($lecturer)->assertCreated();
        $this->direct($elsewhere)->assertForbidden()->assertJsonPath('needs_request', true);

        // Heads (here: HOD of Law) reach people in their area without asking.
        $this->giveRole($lecturer, 'hod', $law->id);
        Sanctum::actingAs($lecturer);
        $this->direct($elsewhere)->assertCreated();
    }

    public function test_groups_only_take_people_you_can_chat_with(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        CurrentInstitution::as($i->id, fn () => \App\Services\Chat\DirectChats::open($ada, $bayo, accepted: true));

        Sanctum::actingAs($ada);
        $r = $this->postJson('/api/conversations/group', ['name' => 'Study', 'member_ids' => [$bayo->id, $chi->id]])->assertCreated();
        $this->assertSame([$chi->id], $r->json('skipped'));
        $this->postJson('/api/conversations/'.$r->json('conversation_id').'/members', ['user_id' => $chi->id])->assertForbidden();
    }
}
