<?php

namespace Tests\Feature;

use App\Jobs\SendPush;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ChatFeaturesTest extends TestCase
{
    use RefreshDatabase;

    private function group(array $members): Conversation
    {
        $i = $members[0]->institution_id;

        return CurrentInstitution::as($i, function () use ($members) {
            $c = Conversation::create(['type' => 'group', 'name' => 'Project team']);
            foreach ($members as $k => $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'role' => $k === 0 ? 'admin' : 'member', 'joined_at' => now()]);
            }

            return $c;
        });
    }

    private function say(Conversation $c, string $body, array $extra = []): array
    {
        return $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => $body] + $extra)
            ->assertCreated()->json('message');
    }

    public function test_reply_carries_a_quote_of_the_original(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i, ['name' => 'Ada Obi']), $this->makeMember($i, ['name' => 'Bayo Ade'])];
        $c = $this->group([$ada, $bayo]);

        Sanctum::actingAs($ada);
        $first = $this->say($c, 'Meeting at 4pm in the library?');
        Sanctum::actingAs($bayo);
        $reply = $this->say($c, 'Yes, see you there', ['reply_to_id' => $first['id']]);

        $this->assertSame($first['id'], $reply['reply_to']['id']);
        $this->assertSame('Ada Obi', $reply['reply_to']['sender_name']);
        $this->assertStringContainsString('library', $reply['reply_to']['body']);
    }

    public function test_reply_to_a_message_in_another_chat_is_ignored(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c1 = $this->group([$ada, $bayo]);
        $c2 = $this->group([$ada, $bayo]);
        Sanctum::actingAs($ada);
        $elsewhere = $this->say($c1, 'secret plans');

        $reply = $this->say($c2, 'hi', ['reply_to_id' => $elsewhere['id']]);
        $this->assertNull($reply['reply_to']);
    }

    public function test_mentions_keep_only_members_and_notify_them_even_when_muted(): void
    {
        Bus::fake([SendPush::class]);
        $i = $this->makeInstitution();
        [$ada, $bayo, $outsider] = [$this->makeMember($i, ['name' => 'Ada Obi']), $this->makeMember($i, ['name' => 'Bayo Ade']), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo]);
        ConversationMember::where('conversation_id', $c->id)->where('user_id', $bayo->id)->update(['muted' => true]);

        Sanctum::actingAs($ada);
        $m = $this->say($c, '@Bayo Ade please check this', ['mentions' => [$bayo->id, $outsider->id]]);

        $this->assertSame([['id' => $bayo->id, 'name' => 'Bayo Ade']], $m['mentions']);
        Bus::assertDispatched(SendPush::class, fn (SendPush $job) => $job->userIds === [$bayo->id] && str_contains($job->title, 'mentioned you'));
    }

    public function test_edit_within_15_minutes_and_search_finds_decrypted_text(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo]);
        Sanctum::actingAs($ada);
        $m = $this->say($c, 'The exam venue is Hall B');
        $this->say($c, 'Bring your ID card');

        $this->patchJson("/api/messages/{$m['id']}", ['body' => 'The exam venue is Hall C'])->assertOk()->assertJsonPath('message.edited', true);

        $results = $this->getJson("/api/conversations/{$c->id}/search?q=hall c")->assertOk()->json('results');
        $this->assertCount(1, $results);
        $this->assertSame($m['id'], $results[0]['id']);

        $around = $this->getJson("/api/conversations/{$c->id}/messages?around={$m['id']}")->assertOk()->json('messages');
        $this->assertContains($m['id'], array_column($around, 'id'));
    }

    public function test_only_members_can_search_a_conversation(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $outsider] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        $c = $this->group([$ada, $bayo]);
        Sanctum::actingAs($outsider);
        $this->getJson("/api/conversations/{$c->id}/search?q=exam")->assertForbidden();
    }

    public function test_member_list_can_be_filtered_by_name_for_mentions(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i, ['name' => 'Ada Obi']), $this->makeMember($i, ['name' => 'Bayo Ade'])];
        $c = $this->group([$ada, $bayo]);
        Sanctum::actingAs($ada);
        $names = array_column($this->getJson("/api/conversations/{$c->id}/members?q=bay")->assertOk()->json('members'), 'name');
        $this->assertSame(['Bayo Ade'], $names);
    }
}
