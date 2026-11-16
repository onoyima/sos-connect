<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Plan;
use App\Models\User;
use App\Services\Billing\Billing;
use App\Services\Billing\Paystack;
use App\Support\Modules;
use App\Support\PlatformSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/** The institution's own view of its subscription: plan, usage, invoices, paying, and changing plan. */
class SubscriptionController extends Controller
{
    public function show(Request $request): Response
    {
        $i = $request->user()->institution;
        $sub = Billing::subscriptionFor($i) ?? Billing::start($i)->load('plan');

        return Inertia::render('Admin/Subscription', [
            'subscription' => PlatformBillingController::subscriptionData($sub),
            'summary' => Billing::summary($i),
            'members' => Billing::membersUsed($i),
            'plans' => Plan::where('is_active', true)->where(fn ($q) => $q->where('is_public', true)->orWhere('id', $sub->plan_id))
                ->orderBy('position')->get(['id', 'name', 'description', 'price_monthly', 'price_yearly', 'max_members', 'modules']),
            'features' => collect(Modules::ALL)->map(fn ($m) => $m['label']),
            'invoices' => Invoice::with('plan:id,name')->where('institution_id', $i->id)->where('status', '!=', 'void')->latest('id')->limit(50)->get()->map->toClient(),
            'payments' => [
                'online' => Paystack::enabled(),
                'bank_transfer' => (bool) PlatformSettings::get('payments.bank_transfer', true),
                'bank_details' => (string) PlatformSettings::get('payments.bank_details', ''),
                'self_service' => (bool) PlatformSettings::get('billing.self_service', true),
            ],
            'currency' => Billing::currency(),
        ]);
    }

    /**
     * The school picks a plan. With self-service on, this raises an invoice to pay (online or by transfer); a free
     * plan starts straight away. Otherwise the platform team is asked through the platform chat.
     */
    public function choose(Request $request): RedirectResponse
    {
        $me = $request->user();
        $i = $me->institution;
        $data = $request->validate(['plan_id' => 'required|integer', 'cycle' => 'required|in:monthly,yearly', 'message' => 'nullable|string|max:500']);
        $plan = Plan::where('is_active', true)->where('is_public', true)->findOrFail($data['plan_id']);

        if (! PlatformSettings::get('billing.self_service', true)) {
            self::tellPlatform($me, "{$i->name} would like the {$plan->name} plan, paid ".($data['cycle'] === 'monthly' ? 'monthly' : 'yearly').'.'
                .(! empty($data['message']) ? "\n\n".$data['message'] : ''));
            AuditLog::record('billing.plan_requested', $plan, ['plan' => $plan->name, 'cycle' => $data['cycle']]);

            return back()->with('status', 'Request sent to the SOS Connect team. They will reply in the platform chat.');
        }

        // Replace any unpaid invoice for a different plan with this one.
        Invoice::where('institution_id', $i->id)->where('status', 'open')->get()->each->update(['status' => 'void']);
        $invoice = Billing::invoiceFor($i, $plan, $data['cycle'], null, $me->id);
        AuditLog::record('billing.plan_chosen', $invoice, ['plan' => $plan->name, 'cycle' => $data['cycle'], 'number' => $invoice->number]);

        if ($invoice->amount === 0) {
            Billing::markPaid($invoice, 'waived', 'Free plan', $me->id);

            return back()->with('status', "You're now on the {$plan->name} plan.");
        }

        return back()->with('status', "Invoice {$invoice->number} is ready. Pay it below to switch to the {$plan->name} plan.");
    }

    /** Asks the platform team to cancel at the end of the paid period (or takes it back). */
    public function cancel(Request $request): RedirectResponse
    {
        $me = $request->user();
        $on = (bool) $request->validate(['cancel' => 'required|boolean'])['cancel'];
        $sub = Billing::subscriptionFor($me->institution);
        abort_unless($sub, 404);
        $sub->update(['cancel_at_period_end' => $on]);
        Billing::forget();
        AuditLog::record($on ? 'billing.cancel_requested' : 'billing.cancel_withdrawn', $sub);
        if ($on) {
            self::tellPlatform($me, "{$me->institution->name} has asked to cancel its subscription at the end of the current period.");
        }

        return back()->with('status', $on ? 'Your subscription will end when the current period ends. You can change your mind before then.' : 'Your subscription will carry on.');
    }

    public function pay(Request $request, Invoice $invoice): HttpResponse
    {
        $me = $request->user();
        abort_unless((int) $invoice->institution_id === (int) $me->institution_id, 404);
        try {
            $url = Paystack::start($invoice, $me->email ?: ($me->institution->contact_email), route('billing.paystack.return'));
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            return back()->with('status', $e->getMessage());
        } catch (\Throwable $e) {
            report($e);

            return back()->with('status', "Online payment couldn't start. Please try again shortly, or pay by bank transfer.");
        }

        return Inertia::location($url);
    }

    /** Paystack sends the payer back here. */
    public function paystackReturn(Request $request): RedirectResponse
    {
        $ref = (string) $request->query('reference', $request->query('trxref', ''));
        $invoice = $ref !== '' ? Paystack::confirm($ref) : null;

        return redirect()->route('admin.subscription')->with('status', $invoice?->status === 'paid'
            ? "Payment received for {$invoice->number}. Thank you!"
            : "We couldn't confirm the payment yet. If you were charged, it will show here within a few minutes.");
    }

    /** Paystack calls this when a payment succeeds (signed with our secret key). */
    public function paystackWebhook(Request $request): JsonResponse
    {
        $payload = $request->getContent();
        if (! Paystack::validSignature($payload, $request->header('x-paystack-signature'))) {
            return response()->json(['ok' => false], 401);
        }
        $event = json_decode($payload, true) ?: [];
        if (($event['event'] ?? null) === 'charge.success' && ! empty($event['data']['reference'])) {
            try {
                Paystack::confirm((string) $event['data']['reference']); // checks with Paystack again before recording
            } catch (\Throwable $e) {
                report($e);

                return response()->json(['ok' => false], 500); // Paystack retries later
            }
        }

        return response()->json(['ok' => true]);
    }

    /** A message to the platform team in the platform chat (one conversation per school admin). */
    public static function tellPlatform(User $from, string $text): void
    {
        $team = User::where('is_platform_admin', true)->where('status', 'active')->pluck('id');
        if ($team->isEmpty()) {
            return;
        }
        DB::transaction(function () use ($from, $text, $team) {
            $title = 'Subscription: '.($from->institution?->short_code ?? 'institution');
            $thread = DB::table('platform_threads')->where('title', $title)->where('created_by', $from->id)->value('id');
            if (! $thread) {
                $thread = DB::table('platform_threads')->insertGetId(['title' => $title, 'is_group' => true, 'created_by' => $from->id, 'created_at' => now(), 'updated_at' => now()]);
                DB::table('platform_thread_members')->insert($team->push($from->id)->unique()
                    ->map(fn ($u) => ['thread_id' => $thread, 'user_id' => $u, 'last_read_id' => 0, 'created_at' => now(), 'updated_at' => now()])->all());
            }
            $id = DB::table('platform_messages')->insertGetId(['thread_id' => $thread, 'user_id' => $from->id, 'body' => $text, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('platform_threads')->where('id', $thread)->update(['last_message_at' => now()]);
            DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', $from->id)->update(['last_read_id' => $id]);
            foreach (DB::table('platform_thread_members')->where('thread_id', $thread)->where('user_id', '!=', $from->id)->pluck('user_id') as $uid) {
                \App\Events\UserSignal::dispatch((int) $uid, 'platform.message', ['thread_id' => $thread, 'from' => $from->name]);
            }
        });
    }
}
