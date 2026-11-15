<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\User;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConnectorLoginTest extends TestCase
{
    use RefreshDatabase;

    private function member(array $overrides = []): array
    {
        return array_merge(['external_id' => 'st-55', 'type' => 'student', 'name' => 'Chidi Okafor', 'email' => 'chidi@student.school.test',
            'identifier' => 'ABC/CSC/21/5501', 'status' => 'active', 'faculty' => ['id' => '3', 'name' => 'Faculty of Natural Sciences'],
            'department' => ['id' => '12', 'name' => 'Computer Science', 'code' => 'CSC'], 'level' => 300, 'date_of_birth' => '2003-05-01'], $overrides);
    }

    public function test_records_never_give_roles_only_sos_connect_does(): void
    {
        $i = $this->makeInstitution();
        Http::fake(['connector.abc.test/*' => $this->connectorResponse(['ok' => true, 'member' => $this->member([
            'external_id' => 'sf-9', 'type' => 'staff', 'name' => 'Dr Okeke', 'email' => 'okeke@school.test', 'level' => null, 'date_of_birth' => null,
            'role' => 'HOD', 'appointments' => [['role' => 'hod', 'unit' => ['type' => 'department', 'id' => '12']]], // ignored
        ])])]);

        $this->postJson('/api/auth/login', ['identifier' => 'okeke', 'password' => 'x'])->assertOk();
        $user = User::where('external_id', 'sf-9')->first();
        $this->assertSame(0, CurrentInstitution::as($i->id, fn () => \App\Models\RoleAssignment::where('user_id', $user->id)->count()));
        $this->assertFalse(\App\Support\Access::can($user, 'announcements.create', $user->department_unit_id));

        // The super admin makes him HOD of his department in SOS Connect: it applies there and nowhere else.
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'super_admin');
        $hod = CurrentInstitution::as($i->id, fn () => \App\Models\Role::where('slug', 'hod')->first());
        // As on the website, where the admin is signed in to their institution.
        CurrentInstitution::as($i->id, fn () => app(\App\Services\Access\RoleManager::class)->assign($admin, $user, $hod, $user->department_unit_id));
        \App\Support\Access::forget();

        $this->assertSame('Head of department, Computer Science', $user->fresh()->title);
        $this->assertTrue(\App\Support\Access::can($user, 'announcements.create', $user->department_unit_id));
        $this->assertFalse(\App\Support\Access::canEverywhere($user, 'announcements.create'));

        // Signing in again doesn't take it away.
        $this->postJson('/api/auth/login', ['identifier' => 'okeke', 'password' => 'x'])->assertOk();
        \App\Support\Access::forget();
        $this->assertTrue(\App\Support\Access::can($user->fresh(), 'announcements.create', $user->department_unit_id));
    }

    public function test_login_with_institution_details_creates_member_and_groups_without_storing_password(): void
    {
        $i = $this->makeInstitution();
        Http::fake(['connector.abc.test/*' => $this->connectorResponse(['ok' => true, 'member' => $this->member()])]);

        $res = $this->postJson('/api/auth/login', ['identifier' => 'ABC/CSC/21/5501', 'password' => 'secret123']);

        $res->assertOk()->assertJsonPath('user.name', 'Chidi Okafor')->assertJsonStructure(['token']);
        $user = User::where('external_id', 'st-55')->first();
        $this->assertNull($user->password);
        $this->assertFalse($user->is_minor);

        $keys = CurrentInstitution::as($i->id, fn () => Conversation::whereIn('id', $user->conversations()->pluck('conversations.id'))->pluck('auto_key')->all());
        $dept = $user->department_unit_id;
        $fac = $user->faculty_unit_id;
        foreach (['inst', 'inst:announcements', 'inst:general', 'inst:students', "fac:$fac", "fac:$fac:students", "fac:$fac:general",
            "dept:$dept", "dept:$dept:general", "dept:$dept:students", "dept:$dept:level:300"] as $key) {
            $this->assertContains($key, $keys, "missing $key");
        }
        $this->assertNotContains('inst:staff', $keys); // students never land in staff groups
        $this->assertNotContains("dept:$dept:staff", $keys);

        Http::assertSent(fn ($req) => $req->hasHeader('X-SOS-Signature') && str_ends_with($req->url(), '/v1/verify'));
    }

    public function test_records_bring_hostel_courses_class_rep_and_guardians(): void
    {
        $i = $this->makeInstitution();
        $i->update(['settings' => array_merge($i->settings, ['modules' => ['parents' => true]])]);
        Http::fake(['connector.abc.test/*' => $this->connectorResponse(['ok' => true, 'member' => $this->member([
            'hostel' => ['id' => '4', 'name' => 'Hall A', 'room' => 'B12'],
            'programme' => 'B.Sc. Computer Science',
            'courses' => [['id' => '901', 'code' => 'CSC 301', 'title' => 'Data Structures', 'level' => 300, 'department_id' => '12']],
            'guardians' => [['name' => 'Mrs Ngozi Okafor', 'relationship' => 'Mother', 'phone' => '08030000000', 'email' => 'ngozi@example.com']],
        ])])]);

        $this->postJson('/api/auth/login', ['identifier' => 'ABC/CSC/21/5501', 'password' => 'x'])->assertOk();
        $user = User::where('external_id', 'st-55')->first();
        $this->assertSame('Hall A, room B12', $user->residence);

        // Class rep is given in SOS Connect (not from student_roles); their groups update straight away.
        $this->giveRole($user, 'class_representative', $user->department_unit_id);
        app(\App\Services\Groups\AutoGroupSync::class)->sync($user);
        $this->assertSame('B.Sc. Computer Science', $user->programme);

        CurrentInstitution::as($i->id, function () use ($user) {
            $hostel = \App\Models\OrgUnit::find($user->hostel_unit_id);
            $this->assertSame('hostel', $hostel->type);
            $course = \App\Models\Course::where('code', 'CSC 301')->first();
            $this->assertSame($user->department_unit_id, $course->org_unit_id); // course belongs to its department

            $keys = Conversation::whereIn('id', $user->conversations()->pluck('conversations.id'))->pluck('auto_key')->all();
            $this->assertContains("hostel:{$hostel->id}", $keys);
            $this->assertContains("course:{$course->id}", $keys);

            // Class rep: admin of their own level group with the post power only.
            $level = Conversation::where('auto_key', "dept:{$user->department_unit_id}:level:300")->first();
            $m = $level->memberships()->where('user_id', $user->id)->first();
            $this->assertSame('admin', $m->role);
            $this->assertSame(['post'], $m->admin_permissions);

            // Guardian becomes a parent account (no password) linked to the student.
            $parent = User::where('member_type', 'parent')->where('email', 'ngozi@example.com')->first();
            $this->assertNotNull($parent);
            $this->assertNull($parent->password);
            $this->assertTrue(\App\Models\GuardianLink::where('parent_id', $parent->id)->where('student_id', $user->id)->exists());
        });
    }

    public function test_inactive_member_at_institution_cannot_log_in(): void
    {
        $i = $this->makeInstitution();
        Http::fake(['*' => $this->connectorResponse(['ok' => true, 'member' => $this->member(['status' => 'inactive'])])]);

        $this->postJson('/api/auth/login', ['identifier' => 'x', 'password' => 'y'])->assertStatus(422);
    }

    public function test_forged_connector_response_is_rejected(): void
    {
        $i = $this->makeInstitution();
        Http::fake(['*' => Http::response(json_encode(['ok' => true, 'member' => $this->member()]), 200,
            ['X-SOS-Timestamp' => (string) time(), 'X-SOS-Signature' => 'forged'])]);

        $this->postJson('/api/auth/login', ['identifier' => 'x', 'password' => 'y'])->assertStatus(422);
        $this->assertDatabaseMissing('users', ['external_id' => 'st-55']);
    }

    public function test_minor_is_flagged_for_guardian_consent(): void
    {
        $i = $this->makeInstitution();
        Http::fake(['*' => $this->connectorResponse(['ok' => true, 'member' => $this->member(['date_of_birth' => now()->subYears(16)->toDateString()])])]);

        $this->postJson('/api/auth/login', ['identifier' => 'x', 'password' => 'y'])
            ->assertOk()->assertJsonPath('user.needs_guardian_consent', true);
    }
}
