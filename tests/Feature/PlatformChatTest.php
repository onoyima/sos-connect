<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Platform chat: platform owners ↔ each other ↔ school admins; nobody else. */
class PlatformChatTest extends TestCase
{
    use RefreshDatabase;

    private function owner(string $email): User
    {
        return User::forceCreate(['email' => $email, 'name' => ucfirst(strtok($email, '@')), 'auth_source' => 'local', 'member_type' => 'admin',
            'password' => 'a-long-password', 'status' => 'active', 'is_platform_admin' => true]);
    }

    public function test_owners_and_school_admins_chat_across_schools(): void
    {
        $one = $this->owner('ada@platform.test');
        $two = $this->owner('bayo@platform.test');
        $a = $this->makeInstitution('AAA');
        $b = $this->makeInstitution('BBB');
        $adminA = $this->makeMember($a, ['member_type' => 'staff', 'name' => 'Admin A']);
        $this->giveRole($adminA, 'institution_admin');
        $adminB = $this->makeMember($b, ['member_type' => 'staff', 'name' => 'Admin B']);
        $this->giveRole($adminB, 'institution_admin');
        $student = $this->makeMember($a);

        // An owner finds the other owner and both schools' admins, never a student.
        Sanctum::actingAs($one);
        $found = collect($this->getJson('/api/platform-chat/people')->assertOk()->json('people'))->pluck('id');
        $this->assertTrue($found->contains($two->id) && $found->contains($adminA->id) && $found->contains($adminB->id));
        $this->assertFalse($found->contains($student->id));

        // Owner ↔ owner.
        $t = $this->postJson('/api/platform-chat', ['user_ids' => [$two->id]])->assertCreated()->json('id');
        $this->postJson("/api/platform-chat/{$t}/messages", ['body' => 'Morning'])->assertCreated();
        $this->postJson('/api/platform-chat', ['user_ids' => [$two->id]])->assertOk()->assertJsonPath('id', $t); // same conversation again

        // A group with admins from two schools.
        $g = $this->postJson('/api/platform-chat', ['user_ids' => [$adminA->id, $adminB->id], 'title' => 'Onboarding'])->assertCreated()->json('id');
        $this->postJson("/api/platform-chat/{$g}/messages", ['body' => 'Welcome both'])->assertCreated();

        // The other owner sees one unread message.
        Sanctum::actingAs($two);
        $this->getJson('/api/platform-chat')->assertOk()->assertJsonPath('unread', 1);
        $this->getJson("/api/platform-chat/{$t}/messages")->assertJsonPath('messages.0.body', 'Morning');
        $this->getJson('/api/platform-chat')->assertJsonPath('unread', 0);

        // A school admin replies in the group and can reach the platform team, but not another school's admin directly.
        Sanctum::actingAs($adminA);
        $this->getJson("/api/platform-chat/{$g}/messages")->assertJsonPath('messages.0.body', 'Welcome both');
        $this->postJson("/api/platform-chat/{$g}/messages", ['body' => 'Thanks'])->assertCreated();
        $this->postJson('/api/platform-chat', ['user_ids' => [$one->id]])->assertCreated();
        $this->postJson('/api/platform-chat', ['user_ids' => [$adminB->id]])->assertForbidden();
        $this->getJson("/api/platform-chat/{$t}/messages")->assertNotFound(); // not a member of the owners' chat
        $people = collect($this->getJson('/api/platform-chat/people')->json('people'))->pluck('id');
        $this->assertFalse($people->contains($adminB->id));

        // Students don't get the platform chat at all.
        Sanctum::actingAs($student);
        $this->getJson('/api/platform-chat')->assertForbidden();
        $this->postJson('/api/platform-chat', ['user_ids' => [$one->id]])->assertForbidden();
    }
}
