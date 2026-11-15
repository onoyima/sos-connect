<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Services\Import\CampusChatImport;
use App\Support\CurrentInstitution;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Brings a small copy of the old campus chat (comm_* tables) across, twice, and checks nothing is duplicated. */
class CampusChatImportTest extends TestCase
{
    use RefreshDatabase;

    private function oldChat(): \Illuminate\Database\Connection
    {
        $file = sys_get_temp_dir().'/old-chat-'.uniqid().'.sqlite';
        touch($file);
        config(['database.connections.old_chat' => ['driver' => 'sqlite', 'database' => $file, 'prefix' => '', 'foreign_key_constraints' => false]]);
        $db = DB::connection('old_chat');
        $s = $db->getSchemaBuilder();
        $s->create('comm_chat_identities', function (Blueprint $t) {
            $t->id(); $t->string('email'); $t->string('entity_type'); $t->integer('entity_id'); $t->string('display_name'); $t->string('role');
            $t->integer('department_id')->nullable(); $t->integer('faculty_id')->nullable();
        });
        $s->create('comm_conversations', function (Blueprint $t) {
            $t->id(); $t->string('type'); $t->string('scope')->nullable(); $t->integer('reference_id')->nullable(); $t->string('name')->nullable(); $t->dateTime('created_at')->nullable();
        });
        $s->create('comm_participants', function (Blueprint $t) {
            $t->id(); $t->integer('conversation_id'); $t->integer('identity_id'); $t->string('role')->default('member'); $t->dateTime('joined_at')->nullable();
        });
        $s->create('comm_messages', function (Blueprint $t) {
            $t->id(); $t->integer('conversation_id'); $t->integer('sender_identity_id'); $t->text('content'); $t->string('type')->default('text');
            $t->json('metadata')->nullable(); $t->boolean('is_edited')->default(false); $t->dateTime('created_at')->nullable();
        });
        $s->create('comm_announcements', function (Blueprint $t) {
            $t->id(); $t->string('title'); $t->text('content'); $t->integer('author_identity_id'); $t->boolean('is_featured')->default(false); $t->dateTime('created_at')->nullable();
        });

        $db->table('comm_chat_identities')->insert([
            ['id' => 1, 'email' => 'ada@student.school.test', 'entity_type' => 'student', 'entity_id' => 1, 'display_name' => 'Ada Obi', 'role' => 'STUDENT', 'department_id' => 21, 'faculty_id' => 2],
            ['id' => 2, 'email' => 'tolu@student.school.test', 'entity_type' => 'student', 'entity_id' => 2, 'display_name' => 'Tolu Ade', 'role' => 'STUDENT', 'department_id' => 21, 'faculty_id' => 2],
            ['id' => 3, 'email' => 'okeke@school.test', 'entity_type' => 'staff', 'entity_id' => 1, 'display_name' => 'Dr Okeke', 'role' => 'STAFF', 'department_id' => 21, 'faculty_id' => 2],
        ]);
        $db->table('comm_conversations')->insert([
            ['id' => 10, 'type' => 'DIRECT', 'scope' => 'PRIVATE', 'reference_id' => null, 'name' => null, 'created_at' => '2025-03-01 09:00:00'],
            ['id' => 11, 'type' => 'GROUP', 'scope' => 'PRIVATE', 'reference_id' => null, 'name' => 'Lab partners', 'created_at' => '2025-03-01 09:00:00'],
            ['id' => 12, 'type' => 'GROUP', 'scope' => 'department_student', 'reference_id' => 21, 'name' => 'Physics Students', 'created_at' => '2025-03-01 09:00:00'],
        ]);
        $db->table('comm_participants')->insert([
            ['conversation_id' => 10, 'identity_id' => 1, 'role' => 'member'], ['conversation_id' => 10, 'identity_id' => 2, 'role' => 'member'],
            ['conversation_id' => 11, 'identity_id' => 1, 'role' => 'admin'], ['conversation_id' => 11, 'identity_id' => 2, 'role' => 'member'], ['conversation_id' => 11, 'identity_id' => 3, 'role' => 'member'],
            ['conversation_id' => 12, 'identity_id' => 1, 'role' => 'member'],
        ]);
        $db->table('comm_messages')->insert([
            ['id' => 100, 'conversation_id' => 10, 'sender_identity_id' => 1, 'content' => 'Hi Tolu', 'type' => 'text', 'metadata' => null, 'created_at' => '2025-03-01 10:00:00'],
            ['id' => 101, 'conversation_id' => 10, 'sender_identity_id' => 2, 'content' => 'Image', 'type' => 'image', 'metadata' => '{"url":"/uploads/a.jpg"}', 'created_at' => '2025-03-01 10:01:00'],
            ['id' => 102, 'conversation_id' => 11, 'sender_identity_id' => 3, 'content' => 'Lab report due Friday', 'type' => 'text', 'metadata' => null, 'created_at' => '2025-03-02 10:00:00'],
            ['id' => 103, 'conversation_id' => 12, 'sender_identity_id' => 1, 'content' => 'Anyone has PHY 101 notes?', 'type' => 'text', 'metadata' => null, 'created_at' => '2025-03-03 10:00:00'],
        ]);
        $db->table('comm_announcements')->insert([
            ['id' => 1, 'title' => 'Exams', 'content' => 'Exams start on Monday.', 'author_identity_id' => 3, 'is_featured' => true, 'created_at' => '2025-03-04 08:00:00'],
        ]);

        return $db;
    }

    public function test_old_chat_comes_across_once_and_lands_in_the_right_places(): void
    {
        $i = $this->makeInstitution();
        $faculty = $this->makeUnit($i, 'faculty', 'Faculty of Natural Sciences');
        $physics = $this->makeUnit($i, 'department', 'Physics', $faculty->id);
        CurrentInstitution::as($i->id, fn () => $physics->update(['external_id' => '21']));
        $old = $this->oldChat();

        $n = app(CampusChatImport::class)->run($i, $old, 'https://oldchat.school.test');
        $this->assertSame(3, $n['people']);
        $this->assertSame(1, $n['private_chats']);
        $this->assertSame(1, $n['groups']);
        $this->assertSame(1, $n['standing_groups']);
        $this->assertSame(4, $n['messages']);
        $this->assertSame(1, $n['announcements']);

        CurrentInstitution::as($i->id, function () use ($physics) {
            $ada = User::where('external_id', 'st-1')->first();
            $this->assertSame('Ada Obi', $ada->name);
            $this->assertSame($physics->id, $ada->department_unit_id);
            $this->assertSame('staff', User::where('external_id', 'sf-1')->value('member_type'));

            $photo = Message::all()->firstWhere('body', 'Photo'); // text is encrypted, so compare after loading
            $this->assertSame('https://oldchat.school.test/uploads/a.jpg', $photo->meta['legacy_url']);

            $standing = Conversation::where('auto_key', "dept:{$physics->id}:students")->first();
            $this->assertNotNull($standing);
            $this->assertSame(1, Message::where('conversation_id', $standing->id)->count());

            $lab = Conversation::where('name', 'Lab partners')->first();
            $this->assertSame(3, $lab->members()->count());
            $this->assertSame('urgent', Announcement::first()->priority);
        });

        // Running again changes nothing.
        $again = app(CampusChatImport::class)->run($i, $old);
        $this->assertSame(0, $again['people'] + $again['messages'] + $again['announcements'] + $again['groups']);
        $this->assertSame(4, CurrentInstitution::as($i->id, fn () => Message::count()));
    }

    public function test_dry_run_changes_nothing(): void
    {
        $i = $this->makeInstitution();
        $n = app(CampusChatImport::class)->run($i, $this->oldChat(), dryRun: true);
        $this->assertSame(3, $n['people']);
        $this->assertSame(0, CurrentInstitution::as($i->id, fn () => Message::count() + Conversation::where('type', 'group')->count()));
        $this->assertDatabaseMissing('users', ['external_id' => 'st-1']);
    }
}
