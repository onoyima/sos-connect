<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_member_cannot_read_another_institutions_conversation(): void
    {
        $a = $this->makeInstitution('AAA');
        $b = $this->makeInstitution('BBB');
        $outsider = $this->makeMember($b);

        $conversation = CurrentInstitution::as($a->id, fn () => Conversation::create(['type' => 'group', 'name' => 'A only']));

        Sanctum::actingAs($outsider);
        $this->getJson("/api/conversations/{$conversation->id}/messages")->assertNotFound();
    }

    public function test_non_members_of_a_conversation_get_403(): void
    {
        $a = $this->makeInstitution();
        $member = $this->makeMember($a);
        $other = $this->makeMember($a);
        $conversation = CurrentInstitution::as($a->id, fn () => Conversation::create(['type' => 'group', 'name' => 'Private']));
        ConversationMember::create(['conversation_id' => $conversation->id, 'user_id' => $member->id, 'role' => 'admin']);

        Sanctum::actingAs($other);
        $this->getJson("/api/conversations/{$conversation->id}/messages")->assertForbidden();

        Sanctum::actingAs($member);
        $this->getJson("/api/conversations/{$conversation->id}/messages")->assertOk();
    }

    public function test_directory_search_never_returns_other_institutions(): void
    {
        $a = $this->makeInstitution('AAA');
        $b = $this->makeInstitution('BBB');
        $me = $this->makeMember($a, ['name' => 'Ada Obi']);
        $this->makeMember($b, ['name' => 'Ada Other']);

        Sanctum::actingAs($this->makeMember($a));
        $this->getJson('/api/directory?q=Ada')->assertOk()->assertJsonCount(1, 'people')->assertJsonPath('people.0.id', $me->id);
    }

    public function test_suspended_members_are_blocked_immediately(): void
    {
        $user = $this->makeMember($this->makeInstitution(), ['status' => 'suspended']);
        Sanctum::actingAs($user);
        $this->getJson('/api/conversations')->assertForbidden();
    }
}
