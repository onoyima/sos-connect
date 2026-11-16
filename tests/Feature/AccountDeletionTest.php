<?php

namespace Tests\Feature;

use App\Models\AccountDeletion;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\DataRequest;
use App\Models\Message;
use App\Models\User;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** "Delete my account" closes the account (status "deleted"); nothing is erased and the institution can trace and restore it. */
class AccountDeletionTest extends TestCase
{
    use RefreshDatabase;

    public function test_deleting_closes_the_account_and_keeps_everything_for_the_institution(): void
    {
        $i = $this->makeInstitution();
        $ada = $this->makeMember($i, ['name' => 'Ada Obi', 'identifier' => 'ABC/24/0001', 'phone' => '08030000000']);
        $ben = $this->makeMember($i);
        $c = CurrentInstitution::as($i->id, function () use ($ada, $ben) {
            $c = Conversation::create(['type' => 'group', 'name' => 'Team']);
            foreach ([$ada, $ben] as $m) {
                ConversationMember::create(['conversation_id' => $c->id, 'user_id' => $m->id, 'role' => 'member', 'joined_at' => now()]);
            }

            return $c;
        });
        Sanctum::actingAs($ada);
        $this->postJson("/api/conversations/{$c->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'body' => 'Hello'])->assertCreated();

        $this->deleteJson('/api/privacy/account', ['confirm' => 'DELETE', 'reason' => 'Too many groups'])->assertOk();

        $ada->refresh();
        $this->assertSame('deleted', $ada->status);
        $this->assertSame('Ada Obi', $ada->name);                                   // nothing erased
        $this->assertSame('ABC/24/0001', $ada->identifier);
        $this->assertSame(1, Message::withoutGlobalScopes()->where('sender_id', $ada->id)->count());
        $this->assertSame(1, ConversationMember::withoutGlobalScopes()->where('user_id', $ada->id)->count());

        $record = AccountDeletion::where('user_id', $ada->id)->first();
        $this->assertSame('closed', $record->status);
        $this->assertSame('Ada Obi', $record->snapshot['name']);
        $this->assertSame('Too many groups', $record->reason);
        $this->assertSame('erasure', DataRequest::find($record->data_request_id)->type); // for the data protection officer

        // Signed out: the closed account can't use the app any more.
        $this->app['auth']->forgetGuards();
        $this->withToken('nope')->getJson('/api/me')->assertStatus(401);
    }

    public function test_admins_trace_and_restore_deleted_accounts(): void
    {
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $student = $this->makeMember($i, ['name' => 'Chidi Eze']);
        $other = $this->makeMember($i);
        \App\Services\Accounts\AccountClosure::close($student, 'app', 'Leaving');

        $this->actingAs($other)->get('/admin/deleted-accounts')->assertForbidden();
        $this->actingAs($admin)->get('/admin/deleted-accounts')->assertOk();
        $this->actingAs($admin)->get('/admin/deleted-accounts?q=Chidi')->assertOk();
        $this->actingAs($admin)->get('/admin/deleted-accounts/export')->assertOk();

        $record = AccountDeletion::where('user_id', $student->id)->first();
        $this->actingAs($admin)->post("/admin/deleted-accounts/{$record->id}/restore", [])->assertSessionHasErrors('note');
        $this->actingAs($admin)->post("/admin/deleted-accounts/{$record->id}/restore", ['note' => 'Asked to come back'])->assertSessionHasNoErrors();

        $this->assertSame('active', $student->fresh()->status);
        $this->assertSame('restored', $record->fresh()->status);
        $this->assertSame($admin->id, (int) $record->fresh()->restored_by);
    }

    public function test_a_deleted_account_cannot_sign_in_again(): void
    {
        $i = $this->makeInstitution();
        $parent = User::forceCreate(['institution_id' => $i->id, 'auth_source' => 'local', 'member_type' => 'parent', 'name' => 'Mrs Obi',
            'email' => 'parent@home.test', 'password' => 'a-long-password', 'status' => 'active', 'policy_version' => config('sos.legal.policy_version')]);
        \App\Services\Accounts\AccountClosure::close($parent, 'web');

        $this->post('/login', ['identifier' => 'parent@home.test', 'password' => 'a-long-password'])->assertSessionHasErrors('identifier');
        $this->assertGuest();
        $this->assertStringContainsString('deleted', session('errors')->first('identifier'));
    }
}
