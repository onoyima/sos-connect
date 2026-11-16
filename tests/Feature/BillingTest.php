<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\Billing\Billing;
use App\Support\Modules;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Plans, trials, enforcement, invoices and payments (software as a service). */
class BillingTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        return User::forceCreate(['email' => 'owner@platform.test', 'name' => 'Owner', 'auth_source' => 'local', 'member_type' => 'admin',
            'password' => 'a-long-password', 'status' => 'active', 'is_platform_admin' => true, 'policy_version' => config('sos.legal.policy_version')]);
    }

    private function enforce(bool $on = true): void
    {
        PlatformSettings::put(['billing.enforce' => $on]);
        Billing::forget();
        \App\Support\Access::forget();
    }

    public function test_new_institutions_start_a_trial_and_nothing_is_limited_until_enforced(): void
    {
        $i = $this->makeInstitution();
        $sub = Subscription::where('institution_id', $i->id)->first();
        $this->assertSame('trialing', $sub->status);
        $this->assertSame('standard', $sub->plan->slug);
        $this->assertTrue($sub->trial_ends_at->isFuture());

        // Standard has no face capture, but enforcement is off: the school's own switches decide.
        $i->update(['settings' => array_merge($i->settings, ['modules' => ['face_capture' => true]])]);
        $this->assertTrue(Modules::enabled($i->fresh(), 'face_capture'));

        $this->enforce();
        $this->assertFalse(Modules::enabled($i->fresh(), 'face_capture'));
        $this->assertTrue(Modules::enabled($i->fresh(), 'video_calls'));
    }

    public function test_lapsed_institutions_keep_only_safety_features(): void
    {
        $i = $this->makeInstitution();
        $this->enforce();
        Subscription::where('institution_id', $i->id)->update(['status' => 'expired']);
        Billing::forget();
        $this->assertFalse(Modules::enabled($i, 'direct_chat'));
        $this->assertTrue(Modules::enabled($i, 'announcements'));
        $this->assertTrue(Modules::enabled($i, 'safety_checks'));

        PlatformSettings::put(['billing.lapse_limits_features' => false]);
        Billing::forget();
        $this->assertTrue(Modules::enabled($i, 'direct_chat'));
    }

    public function test_member_limit(): void
    {
        $i = $this->makeInstitution();
        $this->makeMember($i);
        $this->makeMember($i);
        Subscription::where('institution_id', $i->id)->update(['max_members_override' => 2]);
        Billing::forget();
        $this->assertFalse(Billing::memberLimitReached($i)); // not enforced yet
        $this->enforce();
        $this->assertTrue(Billing::memberLimitReached($i));
    }

    public function test_daily_run_moves_subscriptions_along(): void
    {
        $paid = Plan::where('slug', 'standard')->first();
        $paid->update(['price_yearly' => 50_000_000]);
        $a = $this->makeInstitution('AAA');
        $b = $this->makeInstitution('BBB');
        $free = Plan::create(['slug' => 'free', 'name' => 'Free', 'modules' => ['announcements'], 'price_monthly' => 0, 'price_yearly' => 0]);
        $c = $this->makeInstitution('CCC');
        Subscription::where('institution_id', $c->id)->update(['plan_id' => $free->id]);

        Subscription::whereIn('institution_id', [$a->id, $c->id])->update(['trial_ends_at' => now()->subDay()]);
        Subscription::where('institution_id', $b->id)->update(['status' => 'past_due', 'past_due_at' => now()->subDays(30)]);
        Billing::tick();

        $this->assertSame('past_due', Subscription::where('institution_id', $a->id)->value('status'));
        $this->assertSame(1, Invoice::where('institution_id', $a->id)->where('status', 'open')->where('amount', 50_000_000)->count());
        $this->assertSame('expired', Subscription::where('institution_id', $b->id)->value('status'));
        $this->assertSame('active', Subscription::where('institution_id', $c->id)->value('status')); // free plan renews itself
    }

    public function test_platform_owner_manages_plans_subscriptions_and_payments(): void
    {
        $owner = $this->owner();
        $i = $this->makeInstitution();
        $this->actingAs($owner)->get('/platform/institutions')->assertOk();
        $this->actingAs($owner)->get("/platform/institutions/{$i->id}")->assertOk();
        $this->actingAs($owner)->get('/platform/plans')->assertOk();
        $this->actingAs($owner)->get('/platform/billing')->assertOk();

        $this->actingAs($owner)->post('/platform/plans', ['name' => 'Campus Plus', 'price_monthly' => 10_000_00, 'price_yearly' => 100_000_00,
            'max_members' => 5000, 'modules' => ['level_groups'], 'is_public' => true, 'is_active' => true])->assertSessionHasNoErrors();
        $plan = Plan::where('name', 'Campus Plus')->first();
        $this->assertContains('communities', $plan->modules); // brought along: level groups need communities

        $this->actingAs($owner)->post("/platform/institutions/{$i->id}/trial", ['days' => 14])->assertSessionHasNoErrors();
        $this->actingAs($owner)->post("/platform/institutions/{$i->id}/invoices", ['plan_id' => $plan->id, 'cycle' => 'yearly'])->assertSessionHasNoErrors();
        $invoice = Invoice::where('institution_id', $i->id)->first();
        $this->assertSame(100_000_00, $invoice->amount);

        $this->actingAs($owner)->post("/platform/invoices/{$invoice->id}/paid", ['method' => 'bank_transfer', 'reference' => 'TRX-1'])->assertSessionHasNoErrors();
        $sub = Subscription::where('institution_id', $i->id)->first();
        $this->assertSame('active', $sub->status);
        $this->assertSame($plan->id, $sub->plan_id);
        $this->assertTrue($sub->current_period_end->gt(now()->addMonths(11)));

        $this->actingAs($owner)->post('/platform/billing', ['billing' => ['enforce' => true, 'currency' => 'ngn', 'trial_days' => 21, 'grace_days' => 7,
            'default_plan' => 'standard', 'default_cycle' => 'yearly', 'lapse_limits_features' => true, 'self_service' => true, 'reminder_days' => 5],
            'payments' => ['online' => false, 'bank_transfer' => true, 'bank_details' => 'Bank X', 'invoice_due_days' => 10]])->assertSessionHasNoErrors();
        $this->assertTrue(Billing::enforced());
        $this->assertSame('NGN', PlatformSettings::get('billing.currency'));
    }

    public function test_school_admins_see_their_subscription_and_choose_a_plan(): void
    {
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $student = $this->makeMember($i);

        $this->actingAs($student)->get('/admin/subscription')->assertForbidden();
        $this->actingAs($admin)->get('/admin/subscription')->assertOk();

        $paid = Plan::where('slug', 'enterprise')->first();
        $paid->update(['price_yearly' => 2_000_000_00]);
        $this->actingAs($admin)->post('/admin/subscription/plan', ['plan_id' => $paid->id, 'cycle' => 'yearly'])->assertSessionHasNoErrors();
        $this->assertSame(1, Invoice::where('institution_id', $i->id)->where('status', 'open')->count());

        // A free plan starts straight away.
        $this->actingAs($admin)->post('/admin/subscription/plan', ['plan_id' => Plan::where('slug', 'starter')->value('id'), 'cycle' => 'yearly'])->assertSessionHasNoErrors();
        $sub = Subscription::where('institution_id', $i->id)->first();
        $this->assertSame('active', $sub->status);
        $this->assertSame('starter', $sub->plan->slug);
        $this->assertSame(0, Invoice::where('institution_id', $i->id)->where('status', 'open')->count()); // the unpaid one was replaced
    }

    public function test_paystack_webhook_needs_a_valid_signature_and_rechecks_the_amount(): void
    {
        config(['services.paystack.secret' => 'sk_test_abc', 'services.paystack.url' => 'https://api.paystack.test']);
        $i = $this->makeInstitution();
        $invoice = Billing::invoiceFor($i, Plan::where('slug', 'standard')->first(), 'yearly', 150_000_00);
        $invoice->update(['gateway_reference' => 'REF-1']);

        $body = json_encode(['event' => 'charge.success', 'data' => ['reference' => 'REF-1']]);
        $this->call('POST', '/webhooks/paystack', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_PAYSTACK_SIGNATURE' => 'wrong'], $body)->assertStatus(401);

        // Paystack says the payment was for less than the invoice: not recorded.
        $paidAmount = 100;
        Http::fake(['api.paystack.test/transaction/verify/*' => function () use (&$paidAmount) {
            return Http::response(['status' => true, 'data' => ['status' => 'success', 'amount' => $paidAmount, 'currency' => 'NGN']]);
        }]);
        $sig = hash_hmac('sha512', $body, 'sk_test_abc');
        $this->call('POST', '/webhooks/paystack', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_PAYSTACK_SIGNATURE' => $sig], $body)->assertOk();
        $this->assertSame('open', $invoice->fresh()->status);

        $paidAmount = 150_000_00;
        $this->call('POST', '/webhooks/paystack', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_PAYSTACK_SIGNATURE' => $sig], $body)->assertOk();
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame('active', Subscription::where('institution_id', $i->id)->value('status'));
    }
}
