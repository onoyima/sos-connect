<?php

namespace Tests\Feature;

use App\Models\Broadcast;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Pop-ups and marquee lines: who may send them, who sees them, pausing. */
class BroadcastsTest extends TestCase
{
    use RefreshDatabase;

    public function test_admins_send_targeted_popups_and_marquees_and_can_pause_them(): void
    {
        $i = $this->makeInstitution();
        $physics = $this->makeUnit($i, 'department', 'Physics');
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $p300 = $this->makeMember($i, ['department_unit_id' => $physics->id, 'level' => 300]);
        $p100 = $this->makeMember($i, ['department_unit_id' => $physics->id, 'level' => 100]);
        $staff = $this->makeMember($i, ['member_type' => 'staff', 'department_unit_id' => $physics->id]);

        $this->actingAs($admin)->get('/admin/broadcasts')->assertOk();
        $this->actingAs($admin)->post('/admin/broadcasts', ['kind' => 'popup', 'style' => 'urgent', 'title' => 'Exams', 'body' => 'Exams start Monday.',
            'audience' => ['type' => 'unit', 'id' => $physics->id, 'who' => 'students', 'level' => 300]])->assertSessionHasNoErrors();
        $this->actingAs($admin)->post('/admin/broadcasts', ['kind' => 'marquee', 'style' => 'info', 'body' => 'Library opens 24 hours this week.',
            'audience' => ['type' => 'all']])->assertSessionHasNoErrors();

        Sanctum::actingAs($p300);
        $this->getJson('/api/broadcasts/active')->assertJsonCount(1, 'popups')->assertJsonPath('popups.0.title', 'Exams')->assertJsonCount(1, 'marquees');
        Sanctum::actingAs($p100);
        $this->getJson('/api/broadcasts/active')->assertJsonCount(0, 'popups')->assertJsonCount(1, 'marquees');
        Sanctum::actingAs($staff);
        $this->getJson('/api/broadcasts/active')->assertJsonCount(0, 'popups');

        $popup = CurrentInstitution::as($i->id, fn () => Broadcast::where('kind', 'popup')->first());
        $this->actingAs($admin)->post("/admin/broadcasts/{$popup->id}/pause")->assertSessionHasNoErrors();
        Sanctum::actingAs($p300);
        $this->getJson('/api/broadcasts/active')->assertJsonCount(0, 'popups');

        // Only people with the permission can send.
        $this->actingAs($p300)->post('/admin/broadcasts', ['kind' => 'popup', 'style' => 'info', 'body' => 'x', 'audience' => ['type' => 'all']])->assertForbidden();
    }
}
