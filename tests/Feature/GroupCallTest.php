<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\GroupCallParticipant;
use App\Models\Message;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GroupCallTest extends TestCase
{
    use RefreshDatabase;

    private function group(array $members, string $posting = 'everyone'): Conversation
    {
        return CurrentInstitution::as($members[0]->institution_id, function () use ($members, $posting) {
            $c = Conversation::create(['type' => 'group', 'name' => 'Study group', 'posting' => $posting]);
            foreach ($members as $k => $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'role' => $k === 0 ? 'admin' : 'member', 'joined_at' => now()]);
            }

            return $c;
        });
    }

    public function test_a_call_starts_joins_and_ends_when_everyone_leaves(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i, ['name' => 'Ada']), $this->makeMember($i, ['name' => 'Bayo']), $this->makeMember($i, ['name' => 'Chi'])];
        $c = $this->group([$ada, $bayo, $chi]);

        Sanctum::actingAs($ada);
        $start = $this->postJson("/api/conversations/{$c->id}/call", ['type' => 'video'])->assertCreated()
            ->assertJsonPath('participants.0.name', 'Ada')->assertJsonPath('in_call', true);
        $uuid = $start->json('call_uuid');

        // A card in the chat with a Join button.
        $card = CurrentInstitution::as($i->id, fn () => Message::where('conversation_id', $c->id)->where('type', 'system')->first());
        $this->assertSame($uuid, $card->meta['call']['uuid']);

        // Starting again joins the running call instead of making a second one.
        Sanctum::actingAs($bayo);
        $this->postJson("/api/conversations/{$c->id}/call", ['type' => 'voice'])->assertOk()->assertJsonPath('call_uuid', $uuid)->assertJsonCount(2, 'participants');
        $this->getJson("/api/conversations/{$c->id}/call")->assertJsonPath('call.call_uuid', $uuid);

        // Setup messages only go to people in the call.
        $this->postJson("/api/group-calls/{$uuid}/signal", ['to' => $ada->id, 'data' => ['sdp' => ['type' => 'offer', 'sdp' => 'x']]])->assertOk();
        $this->postJson("/api/group-calls/{$uuid}/signal", ['to' => $chi->id, 'data' => ['candidate' => []]])->assertStatus(409);

        $this->postJson("/api/group-calls/{$uuid}/leave")->assertOk();
        Sanctum::actingAs($ada);
        $this->postJson("/api/group-calls/{$uuid}/leave")->assertOk();

        $this->getJson("/api/conversations/{$c->id}/call")->assertJsonPath('call', null);
        $this->assertTrue((bool) CurrentInstitution::as($i->id, fn () => $card->fresh()->meta['call']['ended']));
        Sanctum::actingAs($chi);
        $this->postJson("/api/group-calls/{$uuid}/join")->assertStatus(410);
    }

    public function test_only_members_can_join_and_calls_have_a_size_limit(): void
    {
        config(['sos.calls.group_max' => 2]);
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi, $outsider] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo, $chi]);

        Sanctum::actingAs($ada);
        $uuid = $this->postJson("/api/conversations/{$c->id}/call", ['type' => 'voice'])->json('call_uuid');
        Sanctum::actingAs($outsider);
        $this->postJson("/api/group-calls/{$uuid}/join")->assertForbidden();
        Sanctum::actingAs($bayo);
        $this->postJson("/api/group-calls/{$uuid}/join")->assertOk();
        Sanctum::actingAs($chi);
        $this->postJson("/api/group-calls/{$uuid}/join")->assertStatus(409);
    }

    public function test_people_who_dropped_are_not_counted(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo]);
        Sanctum::actingAs($ada);
        $uuid = $this->postJson("/api/conversations/{$c->id}/call", ['type' => 'voice'])->json('call_uuid');

        // Ada's browser closed without hanging up: after a while she no longer counts and the call is over.
        GroupCallParticipant::query()->update(['seen_at' => now()->subMinutes(5)]);
        Sanctum::actingAs($bayo);
        $this->getJson("/api/conversations/{$c->id}/call")->assertJsonPath('call', null);
        $this->postJson("/api/group-calls/{$uuid}/join")->assertStatus(410);
    }

    public function test_admins_only_groups_and_one_to_one_chats(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo], 'admins');
        Sanctum::actingAs($bayo);
        $this->postJson("/api/conversations/{$c->id}/call", ['type' => 'voice'])->assertForbidden();

        $direct = CurrentInstitution::as($i->id, fn () => \App\Services\Chat\DirectChats::open($ada, $bayo, accepted: true));
        $this->postJson("/api/conversations/{$direct->id}/call", ['type' => 'voice'])->assertStatus(422);
    }
}
