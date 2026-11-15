<?php

namespace Tests\Feature;

use App\Jobs\SendPush;
use App\Models\Message;
use App\Models\StatusUpdate;
use App\Models\User;
use App\Services\Chat\DirectChats;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StatusSocialTest extends TestCase
{
    use RefreshDatabase;

    private function postStatus(User $by, array $data = []): int
    {
        Sanctum::actingAs($by);

        return $this->postJson('/api/status', $data + ['body' => 'Exams are done!', 'audience' => 'contacts', 'background' => '#1e7b57'])
            ->assertCreated()->json('id');
    }

    private function friends(User $a, User $b): void
    {
        CurrentInstitution::as($a->institution_id, fn () => DirectChats::open($a, $b, accepted: true));
    }

    public function test_tagged_people_can_see_it_even_outside_the_audience_and_are_told(): void
    {
        Bus::fake([SendPush::class]);
        $i = $this->makeInstitution();
        [$ada, $bayo, $stranger] = [$this->makeMember($i, ['name' => 'Ada']), $this->makeMember($i, ['name' => 'Bayo']), $this->makeMember($i)];

        $id = $this->postStatus($ada, ['mentions' => [$bayo->id]]);
        Sanctum::actingAs($bayo);
        $this->getJson('/api/status')->assertJsonPath('statuses.0.id', $id)->assertJsonPath('statuses.0.mentions.0.name', 'Bayo')
            ->assertJsonPath('statuses.0.background', '#1e7b57');

        // Not tagged and not a contact: can't see it, react to it or comment on it.
        Sanctum::actingAs($stranger);
        $this->getJson('/api/status')->assertJsonCount(0, 'statuses');
        $this->postJson("/api/status/{$id}/react", ['reaction' => 'love'])->assertNotFound();
        $this->postJson("/api/status/{$id}/comments", ['body' => 'hi'])->assertNotFound();
        $this->postJson("/api/status/{$id}/view")->assertNotFound();
    }

    public function test_likes_and_loves(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        $this->friends($ada, $bayo);
        $this->friends($ada, $chi);
        $id = $this->postStatus($ada);

        Sanctum::actingAs($bayo);
        $this->postJson("/api/status/{$id}/react", ['reaction' => 'like'])->assertJsonPath('reactions.like', 1);
        $this->postJson("/api/status/{$id}/react", ['reaction' => 'love'])->assertJsonPath('reactions.like', 0)->assertJsonPath('reactions.love', 1); // one reaction each
        Sanctum::actingAs($chi);
        $this->postJson("/api/status/{$id}/react", ['reaction' => 'love'])->assertJsonPath('reactions.love', 2);
        $this->postJson("/api/status/{$id}/react", ['reaction' => null])->assertJsonPath('reactions.love', 1)->assertJsonPath('my_reaction', null);
        $this->postJson("/api/status/{$id}/react", ['reaction' => 'angry'])->assertStatus(422);

        Sanctum::actingAs($bayo);
        $this->postJson("/api/status/{$id}/view")->assertOk();
        Sanctum::actingAs($ada);
        $this->getJson('/api/status')->assertJsonPath('statuses.0.reactions.love', 1)->assertJsonPath('statuses.0.view_count', 1);
        $this->getJson("/api/status/{$id}/viewers")->assertJsonPath('viewers.0.reaction', 'love');
    }

    public function test_comments_replies_and_who_can_delete_them(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i, ['name' => 'Ada']), $this->makeMember($i, ['name' => 'Bayo']), $this->makeMember($i, ['name' => 'Chi'])];
        $this->friends($ada, $bayo);
        $this->friends($ada, $chi);
        $id = $this->postStatus($ada);

        Sanctum::actingAs($bayo);
        $first = $this->postJson("/api/status/{$id}/comments", ['body' => 'Congrats!'])->assertCreated()->json('comment');
        Sanctum::actingAs($chi);
        $reply = $this->postJson("/api/status/{$id}/comments", ['body' => 'Same here', 'reply_to_id' => $first['id']])->assertCreated()->json('comment');
        $this->assertSame('Bayo', $reply['reply_to']['name']);
        $this->assertFalse($this->getJson("/api/status/{$id}/comments")->json('comments.0.can_delete')); // Bayo's
        $this->deleteJson("/api/status/{$id}/comments/{$first['id']}")->assertForbidden();

        Sanctum::actingAs($ada); // the poster can tidy up comments on their own status
        $this->getJson('/api/status')->assertJsonPath('statuses.0.comment_count', 2);
        $this->deleteJson("/api/status/{$id}/comments/{$first['id']}")->assertOk();
        $this->getJson("/api/status/{$id}/comments")->assertJsonCount(1, 'comments');
    }

    public function test_private_reply_goes_to_a_one_to_one_chat_with_the_status_attached(): void
    {
        $i = $this->makeInstitution();
        $bursary = $this->makeUnit($i, 'admin_department', 'Bursary');
        [$ada, $bayo] = [$this->makeMember($i, ['member_type' => 'staff', 'admin_unit_id' => $bursary->id]), $this->makeMember($i, ['member_type' => 'staff', 'admin_unit_id' => $bursary->id])];
        $student = $this->makeMember($i);
        $id = $this->postStatus($ada, ['audience' => 'institution', 'body' => 'New office hours']);

        // A student can see it, but has to send a chat request before messaging a member of staff.
        Sanctum::actingAs($student);
        $this->postJson("/api/status/{$id}/reply", ['body' => 'Hello'])->assertForbidden()->assertJsonPath('needs_request', true);

        Sanctum::actingAs($bayo);
        $r = $this->postJson("/api/status/{$id}/reply", ['body' => 'Noted, thanks'])->assertCreated();
        [$body, $meta, $type] = CurrentInstitution::as($i->id, function () use ($r) {
            $m = Message::find($r->json('message.id'));

            return [$m->body, $m->meta, $m->conversation->type];
        });
        $this->assertSame('Noted, thanks', $body);
        $this->assertSame($id, $meta['status_reply']['id']);
        $this->assertSame('direct', $type);

        Sanctum::actingAs($ada);
        $this->postJson("/api/status/{$id}/reply", ['body' => 'me'])->assertStatus(422); // not to yourself
    }

    public function test_expired_statuses_are_closed(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $this->friends($ada, $bayo);
        $id = $this->postStatus($ada);
        CurrentInstitution::as($i->id, fn () => StatusUpdate::whereKey($id)->update(['expires_at' => now()->subMinute()]));

        Sanctum::actingAs($bayo);
        $this->postJson("/api/status/{$id}/comments", ['body' => 'late'])->assertNotFound();
    }
}
