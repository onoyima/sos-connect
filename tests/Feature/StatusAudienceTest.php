<?php

namespace Tests\Feature;

use App\Services\Chat\DirectChats;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Who sees a status: faculty, chosen people, chosen groups, and people it's hidden from. */
class StatusAudienceTest extends TestCase
{
    use RefreshDatabase;

    private function sees($user, int $statusId): bool
    {
        Sanctum::actingAs($user);

        return collect($this->getJson('/api/status')->json('statuses'))->contains('id', $statusId);
    }

    public function test_faculty_selected_and_hidden(): void
    {
        $i = $this->makeInstitution();
        $sci = $this->makeUnit($i, 'faculty', 'Science');
        $arts = $this->makeUnit($i, 'faculty', 'Arts');
        $ada = $this->makeMember($i, ['faculty_unit_id' => $sci->id]);
        $bayo = $this->makeMember($i, ['faculty_unit_id' => $sci->id]);
        $chi = $this->makeMember($i, ['faculty_unit_id' => $sci->id]);
        $dayo = $this->makeMember($i, ['faculty_unit_id' => $arts->id]);

        Sanctum::actingAs($ada);
        $id = $this->postJson('/api/status', ['body' => 'Science fair', 'audience' => 'faculty', 'hidden' => [$chi->id]])->assertCreated()->json('id');
        $this->assertTrue($this->sees($bayo, $id));
        $this->assertFalse($this->sees($chi, $id));  // hidden from
        $this->assertFalse($this->sees($dayo, $id)); // other faculty

        Sanctum::actingAs($ada);
        $id2 = $this->postJson('/api/status', ['body' => 'Just you two', 'audience' => 'selected', 'people' => [$dayo->id]])->assertCreated()->json('id');
        $this->assertTrue($this->sees($dayo, $id2));
        $this->assertFalse($this->sees($bayo, $id2));

        Sanctum::actingAs($ada);
        $this->postJson('/api/status', ['body' => 'Nobody', 'audience' => 'selected', 'people' => []])->assertStatus(422);
    }

    public function test_chosen_groups(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, fn () => DirectChats::open($ada, $bayo, accepted: true));
        CurrentInstitution::as($i->id, function () use ($ada, $bayo, &$g) {
            $g = \App\Models\Conversation::create(['type' => 'group', 'name' => 'Project team', 'created_by' => $ada->id]);
            foreach ([$ada, $bayo] as $u) {
                \App\Models\ConversationMember::create(['conversation_id' => $g->id, 'user_id' => $u->id, 'role' => 'member', 'joined_at' => now()]);
            }
        });

        Sanctum::actingAs($ada);
        $id = $this->postJson('/api/status', ['body' => 'Team update', 'audience' => 'groups', 'group_ids' => [$g->id]])->assertCreated()->json('id');
        $this->assertTrue($this->sees($bayo, $id));
        $this->assertFalse($this->sees($chi, $id));
    }
}
