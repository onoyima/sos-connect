<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Services\Access\RoleManager;
use App\Services\Groups\AutoGroupSync;
use App\Support\Access;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RolesAndPermissionsTest extends TestCase
{
    use RefreshDatabase;

    public function test_hod_powers_stop_at_their_own_department(): void
    {
        $i = $this->makeInstitution();
        $nas = $this->makeUnit($i, 'faculty', 'Faculty of Natural and Applied Sciences');
        $physics = $this->makeUnit($i, 'department', 'Physics', $nas->id);
        $micro = $this->makeUnit($i, 'department', 'Microbiology', $nas->id);
        $hod = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id, 'faculty_unit_id' => $nas->id]);
        $this->giveRole($hod, 'hod', $physics->id);
        $physicsStudent = $this->makeMember($i, ['department_unit_id' => $physics->id, 'faculty_unit_id' => $nas->id]);
        $microStudent = $this->makeMember($i, ['department_unit_id' => $micro->id, 'faculty_unit_id' => $nas->id]);

        $this->assertTrue(Access::canOnUser($hod, 'members.view', $physicsStudent));
        $this->assertFalse(Access::canOnUser($hod, 'members.view', $microStudent));
        $this->assertFalse(Access::canEverywhere($hod, 'announcements.create'));

        Sanctum::actingAs($hod);
        $notice = ['title' => 'Lab moved', 'body' => 'Lab 2 on Tuesday.', 'audience' => ['type' => 'unit', 'id' => $physics->id]];
        $this->postJson('/api/announcements', $notice)->assertCreated();
        $this->postJson('/api/announcements', ['audience' => ['type' => 'unit', 'id' => $micro->id]] + $notice)->assertForbidden();
        $this->postJson('/api/announcements', ['audience' => ['type' => 'all']] + $notice)->assertForbidden();
    }

    public function test_dean_covers_every_department_in_the_faculty(): void
    {
        $i = $this->makeInstitution();
        $nas = $this->makeUnit($i, 'faculty', 'Faculty of Natural and Applied Sciences');
        $law = $this->makeUnit($i, 'faculty', 'Faculty of Law');
        $physics = $this->makeUnit($i, 'department', 'Physics', $nas->id);
        $dean = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($dean, 'dean', $nas->id);

        $this->assertTrue(Access::can($dean, 'announcements.create', $physics->id));
        $this->assertFalse(Access::can($dean, 'announcements.create', $law->id));
    }

    public function test_a_denied_permission_beats_a_role_and_a_direct_grant_works_without_a_role(): void
    {
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'super_admin');
        $student = $this->makeMember($i);
        $staff = $this->makeMember($i, ['member_type' => 'staff']);
        $roles = app(RoleManager::class);

        $this->assertTrue(Access::can($student, 'status.post'));
        CurrentInstitution::as($i->id, fn () => $roles->grantPermission($admin, $student, 'status.post', 'deny', null));
        $this->assertFalse(Access::can($student, 'status.post'));

        $this->assertFalse(Access::can($staff, 'members.view'));
        CurrentInstitution::as($i->id, fn () => $roles->grantPermission($admin, $staff, 'members.view', 'grant', null));
        $this->assertTrue(Access::can($staff, 'members.view'));
    }

    public function test_you_can_only_give_roles_you_could_do_yourself_in_your_area(): void
    {
        $i = $this->makeInstitution();
        $physics = $this->makeUnit($i, 'department', 'Physics');
        $chem = $this->makeUnit($i, 'department', 'Chemistry');
        $hod = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id]);
        $this->giveRole($hod, 'hod', $physics->id);
        $lecturer = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id]);
        $roles = app(RoleManager::class);

        CurrentInstitution::as($i->id, function () use ($roles, $hod, $physics, $chem) {
            $this->assertTrue($roles->canGiveRole($hod, Role::where('slug', 'lecturer')->first(), $physics->id));
            $this->assertFalse($roles->canGiveRole($hod, Role::where('slug', 'lecturer')->first(), $chem->id));
            $this->assertFalse($roles->canGiveRole($hod, Role::where('slug', 'dean')->first(), $physics->id)); // includes powers they lack
            $this->assertFalse($roles->canGiveRole($hod, Role::where('slug', 'super_admin')->first(), null));
        });
        $this->actingAs($hod);
        CurrentInstitution::set($i->id);
        $roles->assign($hod, $lecturer, Role::where('slug', 'lecturer')->first(), $physics->id);
        $this->assertSame('Lecturer, Physics', $lecturer->fresh()->title);
    }

    public function test_the_last_super_admin_cannot_be_removed(): void
    {
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'super_admin');
        CurrentInstitution::set($i->id);
        $this->actingAs($admin);
        $assignment = RoleAssignment::where('user_id', $admin->id)->first();

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        app(RoleManager::class)->unassign($admin, $assignment);
    }

    public function test_switching_a_feature_off_removes_it_for_everyone_including_super_admins(): void
    {
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'super_admin');
        $this->assertTrue(Access::can($admin, 'status.post'));

        $i->update(['settings' => array_merge($i->settings, ['modules' => ['status' => false]])]);
        Access::forget();
        $this->assertFalse(Access::can($admin->fresh(), 'status.post'));
        $this->assertTrue(Access::can($admin->fresh(), 'sos.raise')); // SOS can never be switched off
    }

    public function test_level_groups_disappear_when_switched_off_and_come_back(): void
    {
        $i = $this->makeInstitution();
        $physics = $this->makeUnit($i, 'department', 'Physics');
        $student = $this->makeMember($i, ['department_unit_id' => $physics->id, 'level' => 200]);
        app(AutoGroupSync::class)->sync($student);
        Sanctum::actingAs($student);

        $names = fn () => collect($this->getJson('/api/conversations')->assertOk()->json('conversations'))->pluck('name')->all();
        $this->assertContains('200 Level Physics', $names());

        $i->update(['settings' => array_merge($i->settings, ['modules' => ['level_groups' => false]])]);
        $student->unsetRelation('institution');
        $this->assertNotContains('200 Level Physics', $names());

        $i->update(['settings' => array_merge($i->settings, ['modules' => ['level_groups' => true]])]);
        $student->unsetRelation('institution');
        $this->assertContains('200 Level Physics', $names());
        $this->assertSame(1, CurrentInstitution::as($i->id, fn () => Conversation::where('auto_type', 'level')->count()));
    }

    public function test_only_people_allowed_to_post_notices_can_write_in_announcement_channels(): void
    {
        $i = $this->makeInstitution();
        $student = $this->makeMember($i);
        $registrar = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($registrar, 'registrar');
        app(AutoGroupSync::class)->sync($student);
        app(AutoGroupSync::class)->sync($registrar);
        $channel = CurrentInstitution::as($i->id, fn () => Conversation::where('auto_key', 'inst:announcements')->first());

        Sanctum::actingAs($student);
        $this->postJson("/api/conversations/{$channel->id}/messages", ['client_id' => (string) \Illuminate\Support\Str::uuid(), 'type' => 'text', 'body' => 'hi'])->assertForbidden();
        Sanctum::actingAs($registrar);
        $this->postJson("/api/conversations/{$channel->id}/messages", ['client_id' => (string) \Illuminate\Support\Str::uuid(), 'type' => 'text', 'body' => 'Exams start Monday'])->assertCreated();
    }
}
