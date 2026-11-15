<?php

namespace Tests\Feature;

use App\Models\OrgUnit;
use App\Models\User;
use App\Services\Structure\StructureSync;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Direct mode: the app reads an institution's records database itself, with the details its admin saved
 * (tests/Fixtures/records.sqlite: a made-up school in the "standard-erp" layout). No connector, no HTTP.
 */
class DirectRecordsTest extends TestCase
{
    use RefreshDatabase;

    private function connectDirect(\App\Models\Institution $i): void
    {
        $copy = sys_get_temp_dir().'/records-'.uniqid().'.sqlite';
        copy(base_path('tests/Fixtures/records.sqlite'), $copy);
        $i->connector->update(['base_url' => 'direct', 'query_set' => 'standard-erp', 'db_settings' => ['driver' => 'sqlite', 'database' => $copy]]);
    }

    public function test_members_sign_in_against_the_records_without_a_connector(): void
    {
        Http::preventStrayRequests(); // nothing goes over the network
        $i = $this->makeInstitution();
        $this->connectDirect($i);

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'wrong'])->assertStatus(422);
        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'secret123'])
            ->assertOk()->assertJsonPath('user.name', 'Adaeze Chioma Okafor');

        $user = User::where('external_id', 'st-1')->first();
        $this->assertSame(100, $user->level);
        $this->assertStringStartsWith('Hall A', $user->residence);
        $this->assertNull($user->password); // the records password is never stored

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/STF/0457', 'password' => 'staffpw'])->assertOk();
        $this->assertSame('staff', User::where('external_id', 'sf-1')->value('member_type'));
    }

    public function test_records_without_some_columns_or_tables_still_sign_people_in(): void
    {
        $i = $this->makeInstitution();
        $this->connectDirect($i);
        // A records system that looks like the standard one but lacks a few columns and a table.
        $pdo = new \PDO('sqlite:'.$i->connector->fresh()->db_settings['database']);
        foreach (['ALTER TABLE student_academics DROP COLUMN studentship', 'ALTER TABLE departments DROP COLUMN abb',
            'ALTER TABLE staff_work_profiles DROP COLUMN admin_department_id', 'DROP TABLE vuna_accomodation_histories'] as $sql) {
            $pdo->exec($sql);
        }
        $pdo = null;

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'wrong'])->assertStatus(422);
        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'secret123'])
            ->assertOk()->assertJsonPath('user.name', 'Adaeze Chioma Okafor');
        $this->postJson('/api/auth/login', ['identifier' => 'ABC/STF/0457', 'password' => 'staffpw'])->assertOk();

        // The connection test passes and names what's missing.
        $health = (new \App\Services\Connector\ConnectorClient($i->connector->fresh()))->health();
        $this->assertTrue($health['ok']);
        $this->assertContains('student_academics.studentship', $health['missing']);
    }

    public function test_graduates_sign_in_as_alumni_and_join_the_alumni_groups(): void
    {
        $i = $this->makeInstitution();
        $this->connectDirect($i);
        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'secret123'])->assertOk();
        $user = User::where('external_id', 'st-1')->first();
        $keys = fn () => CurrentInstitution::as($i->id, fn () => \App\Models\Conversation::whereIn('id',
            \App\Models\ConversationMember::where('user_id', $user->id)->select('conversation_id'))->pluck('auto_key')->all());
        $this->assertContains('inst:students', $keys());

        // They graduate (level 1000+) and the portal switches their account off.
        $pdo = new \PDO('sqlite:'.$i->connector->fresh()->db_settings['database']);
        $pdo->exec('UPDATE student_academics SET level = 1000 WHERE student_id = 1');
        $pdo->exec('UPDATE students SET status = 0 WHERE id = 1');
        $pdo = null;

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'secret123'])->assertOk();
        $user->refresh();
        $this->assertSame('alumni', $user->member_type);
        $this->assertSame(2024, $user->alumni_year); // from the matric number: the 2024 set
        $this->assertNull($user->hostel_unit_id);

        $now = $keys();
        $this->assertContains('alumni:all', $now);
        $this->assertContains('alumni:set:2024', $now);
        $this->assertContains('alumni:dept:'.$user->department_unit_id, $now);
        $this->assertContains('inst:announcements', $now);
        $this->assertNotContains('inst:students', $now); // out of the current-student groups
        $this->assertNotContains('inst:general', $now);
        $this->assertTrue(\App\Support\Access::can($user, 'chat.use'));
    }

    public function test_people_the_records_mark_inactive_are_told_why(): void
    {
        $i = $this->makeInstitution();
        $this->connectDirect($i);
        $pdo = new \PDO('sqlite:'.$i->connector->fresh()->db_settings['database']);
        $pdo->exec('UPDATE student_academics SET studentship = 2 WHERE student_id = 1');
        $pdo = null;

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/PHE/24/0142', 'password' => 'secret123'])
            ->assertStatus(422)->assertSee('deferment');
    }

    public function test_structure_is_read_only_when_asked(): void
    {
        $i = $this->makeInstitution();
        $this->connectDirect($i);
        $this->assertSame(0, CurrentInstitution::as($i->id, fn () => OrgUnit::count())); // nothing copied up front

        $n = app(StructureSync::class)->fromRecords($i);

        $this->assertGreaterThan(0, $n['faculty']);
        $this->assertGreaterThan(0, $n['courses']);
        $this->assertTrue(CurrentInstitution::as($i->id, fn () => OrgUnit::where('type', 'hostel')->exists()));
        $this->assertNotNull($i->fresh()->settings['structure_synced_at'] ?? null);
    }

    public function test_records_connection_can_never_point_at_this_apps_own_database(): void
    {
        $i = $this->makeInstitution();
        $i->connector->update(['base_url' => 'direct', 'query_set' => 'standard-erp',
            'db_settings' => ['driver' => 'sqlite', 'database' => config('database.connections.sqlite.database')]]);

        $this->expectException(\RuntimeException::class);
        app(StructureSync::class)->fromRecords($i);
    }
}
