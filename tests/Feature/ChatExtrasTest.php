<?php

namespace Tests\Feature;

use App\Models\CallLog;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Services\Chat\DirectChats;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Stickers, the red counts, and calls that rang while the app was closed. */
class ChatExtrasTest extends TestCase
{
    use RefreshDatabase;

    public function test_stickers_are_sent_by_name_without_upload_rights(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo] = [$this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, fn () => DirectChats::open($ada, $bayo, accepted: true));

        Sanctum::actingAs($ada);
        $m = $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'sticker', 'body' => 'Thank you',
            'meta' => ['sticker' => 'thanks', 'path' => 'uploads/evil.php']])->assertCreated()->json('message');
        $this->assertSame('sticker', $m['type']);
        $this->assertSame(['sticker' => 'thanks'], $m['meta']); // nothing else gets through
    }

    public function test_red_counts_for_unread_chats_missed_calls_and_requests(): void
    {
        $i = $this->makeInstitution();
        [$ada, $bayo, $chi] = [$this->makeMember($i), $this->makeMember($i), $this->makeMember($i)];
        $c = CurrentInstitution::as($i->id, fn () => DirectChats::open($ada, $bayo, accepted: true));

        Sanctum::actingAs($ada);
        $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => 'hi'])->assertCreated();
        $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => 'there'])->assertCreated();
        CurrentInstitution::as($i->id, fn () => CallLog::create(['call_uuid' => (string) Str::uuid(), 'caller_id' => $ada->id, 'callee_id' => $bayo->id,
            'type' => 'voice', 'status' => 'missed', 'started_at' => now()]));
        Sanctum::actingAs($chi);
        $this->postJson('/api/chat-requests', ['user_id' => $bayo->id])->assertCreated();

        Sanctum::actingAs($bayo);
        $this->getJson('/api/badges')->assertJsonPath('badges.chats', 1)->assertJsonPath('badges.calls', 1)->assertJsonPath('badges.requests', 1);

        // Reading the chat and opening the call list clear them.
        $last = $this->getJson("/api/conversations/{$c->id}/messages")->json('messages');
        $this->postJson("/api/conversations/{$c->id}/read", ['last_read_message_id' => end($last)['id']])->assertOk();
        $this->postJson('/api/calls/seen')->assertOk();
        $this->getJson('/api/badges')->assertJsonPath('badges.chats', 0)->assertJsonPath('badges.calls', 0);
    }

    public function test_a_call_still_ringing_is_shown_when_the_app_opens(): void
    {
        $i = $this->makeInstitution();
        $physics = $this->makeUnit($i, 'department', 'Physics');
        $lecturer = $this->makeMember($i, ['member_type' => 'staff', 'name' => 'Dr Ada', 'department_unit_id' => $physics->id]);
        $student = $this->makeMember($i);

        Sanctum::actingAs($lecturer);
        $uuid = $this->postJson('/api/calls', ['callee_id' => $student->id, 'type' => 'video'])->assertCreated()->json('call_uuid');

        Sanctum::actingAs($student);
        $this->getJson('/api/calls/pending')->assertJsonPath('call.call_uuid', $uuid)->assertJsonPath('call.caller.name', 'Dr Ada')->assertJsonPath('call.type', 'video');
        $this->postJson("/api/calls/{$uuid}/state", ['action' => 'reject'])->assertOk();
        $this->getJson('/api/calls/pending')->assertJsonPath('call', null);
    }
}
