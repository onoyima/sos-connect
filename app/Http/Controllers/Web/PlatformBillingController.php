<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Institution;
use App\Models\Invoice;
use App\Models\Plan;
use App\Models\Subscription;
use App\Services\Billing\Billing;
use App\Services\Billing\Paystack;
use App\Support\Modules;
use App\Support\PlatformSettings;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** The platform owner's software-as-a-service desk: institutions' subscriptions, plans, invoices and billing settings. */
class PlatformBillingController extends Controller
{
    public function show(Institution $institution): Response
    {
        $institution->load(['connector:id,institution_id,last_test_ok,last_tested_at', 'subscription.plan']);
        $sub = $institution->subscription ?? Billing::start($institution)->load('plan');

        return Inertia::render('Platform/InstitutionShow', [
            'institution' => $institution->only(['id', 'name', 'short_code', 'country', 'status', 'contact_name', 'contact_email', 'contact_phone',
                'dpo_name', 'dpo_email', 'security_phone', 'dpa_version', 'dpa_accepted_by', 'verified_at', 'created_at'])
                + ['connector_ok' => (bool) $institution->connector?->last_test_ok, 'members' => Billing::membersUsed($institution),
                    'all_users' => \App\Models\User::where('institution_id', $institution->id)->count()],
            'subscription' => self::subscriptionData($sub),
            'invoices' => Invoice::with('plan:id,name')->where('institution_id', $institution->id)->latest('id')->limit(100)->get()->map->toClient(),
            'plans' => Plan::orderBy('position')->get(['id', 'name', 'slug', 'price_monthly', 'price_yearly', 'max_members', 'is_active']),
            'methods' => Invoice::METHODS,
            'currency' => Billing::currency(),
            'enforced' => Billing::enforced(),
            'audit' => AuditLog::where('institution_id', $institution->id)->where(fn ($q) => $q->where('action', 'like', 'billing.%')->orWhere('action', 'like', 'institution.%'))
                ->latest('id')->limit(30)->get(['id', 'action', 'meta', 'created_at']),
        ]);
    }

    public static function subscriptionData(Subscription $sub): array
    {
        $summary = Billing::summary($sub->institution) ?? [];

        return $sub->only(['id', 'status', 'cycle', 'cancel_at_period_end', 'max_members_override', 'price_override', 'notes'])
            + ['plan_id' => $sub->plan_id, 'plan' => $sub->plan?->name, 'member_limit' => $sub->memberLimit(), 'price' => $sub->price(),
                'trial_ends_at' => $sub->trial_ends_at?->toIso8601String(), 'current_period_start' => $sub->current_period_start?->toIso8601String(),
                'current_period_end' => $sub->current_period_end?->toIso8601String(), 'past_due_at' => $sub->past_due_at?->toIso8601String(),
                'days_left' => $summary['days_left'] ?? null, 'grace_ends_at' => $summary['grace_ends_at'] ?? null];
    }

    /** Change plan, cycle, status, dates, a negotiated price or member limit. */
    public function updateSubscription(Request $request, Institution $institution): RedirectResponse
    {
        $data = $request->validate([
            'plan_id' => 'required|exists:plans,id',
            'cycle' => 'required|in:monthly,yearly',
            'status' => 'required|in:trialing,active,past_due,expired,cancelled',
            'trial_ends_at' => 'nullable|date',
            'current_period_end' => 'nullable|date',
            'max_members_override' => 'nullable|integer|min:1|max:10000000',
            'price_override' => 'nullable|integer|min:0',
            'cancel_at_period_end' => 'boolean',
            'notes' => 'nullable|string|max:1000',
        ]);
        $sub = $institution->subscription ?? Billing::start($institution);
        $before = $sub->only(array_keys($data));
        if ($data['status'] === 'trialing' && empty($data['trial_ends_at'])) {
            return back()->withErrors(['trial_ends_at' => 'Give the date the trial ends.']);
        }
        if ($data['status'] === 'active' && empty($data['current_period_end'])) {
            return back()->withErrors(['current_period_end' => 'Give the date the paid period ends.']);
        }
        $sub->update($data + [
            'past_due_at' => $data['status'] === 'past_due' ? ($sub->past_due_at ?? now()) : null,
            'cancelled_at' => $data['status'] === 'cancelled' ? ($sub->cancelled_at ?? now()) : null,
            'current_period_start' => $data['status'] === 'active' ? ($sub->current_period_start ?? now()) : $sub->current_period_start,
        ]);
        Billing::forget();
        \App\Support\Access::forget();
        AuditLog::record('billing.subscription_changed', $institution, ['before' => $before, 'after' => $sub->only(array_keys($data))], $institution->id);

        return back()->with('status', "{$institution->name}'s subscription saved.");
    }

    public function extendTrial(Request $request, Institution $institution): RedirectResponse
    {
        $days = (int) $request->validate(['days' => 'required|integer|min:1|max:365'])['days'];
        $sub = $institution->subscription ?? Billing::start($institution);
        $from = $sub->trial_ends_at && $sub->trial_ends_at->isFuture() ? $sub->trial_ends_at : now();
        $sub->update(['status' => 'trialing', 'trial_ends_at' => $from->copy()->addDays($days), 'past_due_at' => null, 'cancelled_at' => null]);
        Billing::forget();
        AuditLog::record('billing.trial_extended', $institution, ['days' => $days, 'until' => $sub->trial_ends_at->toDateString()], $institution->id);

        return back()->with('status', "Trial extended by {$days} days, to {$sub->trial_ends_at->format('j M Y')}.");
    }

    public function createInvoice(Request $request, Institution $institution): RedirectResponse
    {
        $data = $request->validate([
            'plan_id' => 'required|exists:plans,id',
            'cycle' => 'required|in:monthly,yearly',
            'amount' => 'nullable|integer|min:0',
        ]);
        $invoice = Billing::invoiceFor($institution, Plan::findOrFail($data['plan_id']), $data['cycle'], $data['amount'] ?? null, $request->user()->id);
        AuditLog::record('billing.invoice_created', $invoice, ['number' => $invoice->number, 'amount' => $invoice->amount], $institution->id);

        return back()->with('status', "Invoice {$invoice->number} created.");
    }

    public function markPaid(Request $request, Invoice $invoice): RedirectResponse
    {
        $data = $request->validate([
            'method' => ['required', Rule::in(array_keys(Invoice::METHODS))],
            'reference' => 'nullable|string|max:120',
            'paid_at' => 'nullable|date|before_or_equal:now',
        ]);
        abort_if($invoice->status !== 'open', 422, 'Only open invoices can be marked as paid.');
        Billing::markPaid($invoice, $data['method'], $data['reference'] ?? null, $request->user()->id, isset($data['paid_at']) ? Carbon::parse($data['paid_at']) : null);

        return back()->with('status', "Invoice {$invoice->number} marked as paid. The subscription is active to the end of its period.");
    }

    public function voidInvoice(Invoice $invoice): RedirectResponse
    {
        abort_if($invoice->status !== 'open', 422, 'Only open invoices can be cancelled.');
        $invoice->update(['status' => 'void']);
        AuditLog::record('billing.invoice_void', $invoice, ['number' => $invoice->number], $invoice->institution_id);

        return back()->with('status', "Invoice {$invoice->number} cancelled.");
    }

    // ---- Plans ----

    public function plans(): Response
    {
        return Inertia::render('Platform/Plans', [
            'plans' => Plan::withCount('subscriptions')->orderBy('position')->get(),
            'modules' => collect(Modules::ALL)->map(fn ($m, $k) => ['key' => $k, 'label' => $m['label'], 'requires' => $m['requires'] ?? null])->values(),
            'currency' => Billing::currency(),
        ]);
    }

    public function savePlan(Request $request, ?Plan $plan = null): RedirectResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:80',
            'description' => 'nullable|string|max:400',
            'price_monthly' => 'required|integer|min:0',
            'price_yearly' => 'required|integer|min:0',
            'max_members' => 'nullable|integer|min:1|max:10000000',
            'trial_days' => 'nullable|integer|min:0|max:365',
            'modules' => 'array',
            'modules.*' => ['string', Rule::in(array_keys(Modules::ALL))],
            'is_public' => 'boolean',
            'is_active' => 'boolean',
            'position' => 'nullable|integer|min:0|max:1000',
        ]);
        // A feature that needs another one brings it along (e.g. level groups need communities).
        $mods = collect($data['modules'] ?? []);
        foreach ($mods->all() as $m) {
            for ($r = Modules::ALL[$m]['requires'] ?? null; $r; $r = Modules::ALL[$r]['requires'] ?? null) {
                $mods->push($r);
            }
        }
        $data['modules'] = $mods->unique()->values()->all();
        $data['position'] ??= 100;

        if ($plan) {
            $plan->update($data);
        } else {
            $base = Str::slug($data['name']) ?: 'plan';
            $slug = $base;
            for ($n = 2; Plan::where('slug', $slug)->exists(); $n++) {
                $slug = "{$base}-{$n}";
            }
            $plan = Plan::create($data + ['slug' => $slug]);
        }
        Billing::forget();
        \App\Support\Access::forget();
        AuditLog::record('billing.plan_saved', $plan, ['name' => $plan->name]);

        return back()->with('status', "{$plan->name} plan saved.");
    }

    // ---- Settings ----

    public function settings(): Response
    {
        return Inertia::render('Platform/Billing', [
            'settings' => PlatformSettings::all(),
            'plans' => Plan::where('is_active', true)->orderBy('position')->get(['slug', 'name']),
            'paystack' => ['configured' => Paystack::configured(), 'webhook' => url('/webhooks/paystack')],
            'stats' => self::stats(),
        ]);
    }

    public function saveSettings(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'billing.enforce' => 'required|boolean',
            'billing.currency' => 'required|string|size:3',
            'billing.trial_days' => 'required|integer|min:0|max:365',
            'billing.grace_days' => 'required|integer|min:0|max:120',
            'billing.default_plan' => 'required|exists:plans,slug',
            'billing.default_cycle' => 'required|in:monthly,yearly',
            'billing.lapse_limits_features' => 'required|boolean',
            'billing.self_service' => 'required|boolean',
            'billing.reminder_days' => 'required|integer|min:0|max:60',
            'payments.online' => 'required|boolean',
            'payments.bank_transfer' => 'required|boolean',
            'payments.bank_details' => 'nullable|string|max:1000',
            'payments.invoice_due_days' => 'required|integer|min:0|max:120',
        ]);
        $flat = [];
        foreach ($data as $group => $values) {
            foreach ($values as $k => $v) {
                $flat["{$group}.{$k}"] = $k === 'currency' ? strtoupper((string) $v) : $v;
            }
        }
        if ($flat['payments.online'] && ! Paystack::configured()) {
            return back()->withErrors(['payments.online' => 'Add PAYSTACK_SECRET_KEY to the server .env first (then php artisan config:cache).']);
        }
        $was = Billing::enforced();
        PlatformSettings::put($flat);
        Billing::forget();
        \App\Support\Access::forget();
        AuditLog::record('billing.settings_saved', null, ['enforce' => $flat['billing.enforce'], 'was' => $was]);

        return back()->with('status', 'Billing settings saved.'.(! $was && $flat['billing.enforce'] ? ' Subscriptions are now enforced: features follow each plan.' : ''));
    }

    /** Numbers for the overview. */
    public static function stats(): array
    {
        $subs = Subscription::with('plan')->get();
        $yearly = $subs->where('status', 'active')->sum(fn (Subscription $s) => $s->cycle === 'monthly' ? $s->price() * 12 : $s->price());

        return [
            'counts' => collect(['trialing', 'active', 'past_due', 'expired', 'cancelled'])->mapWithKeys(fn ($s) => [$s => $subs->where('status', $s)->count()]),
            'annual_revenue' => $yearly,
            'monthly_revenue' => (int) round($yearly / 12),
            'trials_ending' => $subs->where('status', 'trialing')->filter(fn ($s) => $s->trial_ends_at && $s->trial_ends_at->lte(now()->addDays(7)))->count(),
            'open_invoices' => Invoice::where('status', 'open')->count(),
            'open_amount' => (int) Invoice::where('status', 'open')->sum('amount'),
            'paid_30_days' => (int) Invoice::where('status', 'paid')->where('paid_at', '>=', now()->subDays(30))->sum('amount'),
            'currency' => Billing::currency(),
        ];
    }
}
