<?php

namespace App\Services\Billing;

use App\Models\AuditLog;
use App\Models\Institution;
use App\Models\Invoice;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Support\PlatformSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Subscriptions, plans and what an institution may use.
 *
 * SOS is never part of a plan and never stops: it is safety, not a feature. When a subscription lapses (and the
 * owner chose "lapsed institutions lose features"), notices and safety checks keep working too.
 */
class Billing
{
    /** Still on when a subscription has lapsed. */
    public const LAPSED_MODULES = ['announcements', 'safety_checks', 'offline_mesh'];

    /** @var array<int, Subscription|null> */
    private static array $cache = [];

    public static function forget(): void
    {
        self::$cache = [];
    }

    public static function enforced(): bool
    {
        return (bool) PlatformSettings::get('billing.enforce', false);
    }

    public static function currency(): string
    {
        return (string) PlatformSettings::get('billing.currency', 'NGN');
    }

    public static function subscriptionFor(?Institution $institution): ?Subscription
    {
        if (! $institution?->id) {
            return null;
        }
        if (! array_key_exists($institution->id, self::$cache)) {
            try {
                self::$cache[$institution->id] = Subscription::with('plan')->where('institution_id', $institution->id)->first();
            } catch (\Throwable) {
                self::$cache[$institution->id] = null; // billing tables not there yet (before migrating): nothing is limited
            }
        }

        return self::$cache[$institution->id];
    }

    /** Is this feature part of what the institution pays for? (Its admins can still switch it off themselves.) */
    public static function allowsModule(?Institution $institution, string $module): bool
    {
        if (! self::enforced() || ! $institution) {
            return true;
        }
        $sub = self::subscriptionFor($institution);
        if (! $sub || ! $sub->plan) {
            return true; // never cut an institution off because a record is missing
        }
        if ($sub->isLapsed() && PlatformSettings::get('billing.lapse_limits_features', true)) {
            return in_array($module, self::LAPSED_MODULES, true);
        }

        return $sub->plan->includes($module);
    }

    public static function membersUsed(Institution $institution): int
    {
        return User::query()->where('institution_id', $institution->id)->where('status', 'active')
            ->whereIn('member_type', ['student', 'staff'])->count();
    }

    /** True when the plan's member limit is reached (people already in keep working; new people wait). */
    public static function memberLimitReached(Institution $institution): bool
    {
        if (! self::enforced()) {
            return false;
        }
        $limit = self::subscriptionFor($institution)?->memberLimit();

        return $limit !== null && self::membersUsed($institution) >= $limit;
    }

    /** A new institution starts its free trial on the default plan. */
    public static function start(Institution $institution, ?Plan $plan = null): Subscription
    {
        $plan ??= Plan::where('slug', PlatformSettings::get('billing.default_plan', 'standard'))->where('is_active', true)->first()
            ?? Plan::where('is_active', true)->orderBy('position')->firstOrFail();
        $days = $plan->trial_days ?? (int) PlatformSettings::get('billing.trial_days', 30);

        $sub = Subscription::firstOrCreate(['institution_id' => $institution->id], [
            'plan_id' => $plan->id,
            'cycle' => PlatformSettings::get('billing.default_cycle', 'yearly'),
            'status' => $days > 0 ? 'trialing' : 'past_due',
            'trial_ends_at' => $days > 0 ? now()->addDays($days) : null,
            'past_due_at' => $days > 0 ? null : now(),
        ]);
        self::forget();

        return $sub;
    }

    public static function periodEnd(Carbon $start, string $cycle): Carbon
    {
        return $cycle === 'monthly' ? $start->copy()->addMonthNoOverflow() : $start->copy()->addYearNoOverflow();
    }

    public static function nextNumber(): string
    {
        $prefix = 'INV-'.now()->format('Y').'-';
        $last = Invoice::where('number', 'like', $prefix.'%')->orderByDesc('id')->value('number');
        $n = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;

        return $prefix.str_pad((string) $n, 5, '0', STR_PAD_LEFT);
    }

    /**
     * An invoice for the next period of a plan (by default the institution's own plan and cycle). The period starts
     * when the current paid period ends (or today), so paying early never loses days.
     */
    public static function invoiceFor(Institution $institution, ?Plan $plan = null, ?string $cycle = null, ?int $amount = null, ?int $createdBy = null): Invoice
    {
        $sub = self::subscriptionFor($institution) ?? self::start($institution);
        $plan ??= $sub->plan;
        $cycle ??= $sub->cycle;
        $samePlan = $plan->id === $sub->plan_id && $cycle === $sub->cycle;
        $amount ??= $samePlan && $sub->price_override !== null ? $sub->price_override : $plan->price($cycle);

        $from = $sub->current_period_end && $sub->current_period_end->isFuture() && $samePlan ? $sub->current_period_end->copy() : now();
        $to = self::periodEnd($from, $cycle);

        return Invoice::create([
            'institution_id' => $institution->id, 'plan_id' => $plan->id, 'number' => self::nextNumber(),
            'description' => "{$plan->name} plan, ".($cycle === 'monthly' ? 'monthly' : 'yearly')." ({$from->format('j M Y')} to {$to->format('j M Y')})",
            'cycle' => $cycle, 'amount' => $amount, 'currency' => self::currency(), 'status' => 'open',
            'period_start' => $from, 'period_end' => $to,
            'due_at' => now()->addDays((int) PlatformSettings::get('payments.invoice_due_days', 14)), 'created_by' => $createdBy,
        ]);
    }

    /** Payment received (or waived): the invoice is paid and the subscription runs to the end of its period. */
    public static function markPaid(Invoice $invoice, string $method, ?string $reference = null, ?int $recordedBy = null, ?Carbon $paidAt = null): Invoice
    {
        return DB::transaction(function () use ($invoice, $method, $reference, $recordedBy, $paidAt) {
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if ($invoice->status === 'paid') {
                return $invoice; // e.g. the Paystack webhook and the return page both arrive
            }
            $invoice->update(['status' => 'paid', 'method' => $method, 'reference' => $reference ?? $invoice->reference,
                'paid_at' => $paidAt ?? now(), 'recorded_by' => $recordedBy]);

            $institution = $invoice->institution;
            $sub = Subscription::where('institution_id', $institution->id)->lockForUpdate()->first() ?? self::start($institution);
            $start = $invoice->period_start ?? now();
            $end = $invoice->period_end ?? self::periodEnd($start, $invoice->cycle ?? $sub->cycle);
            $sub->update([
                'plan_id' => $invoice->plan_id ?? $sub->plan_id,
                'cycle' => $invoice->cycle ?? $sub->cycle,
                'status' => 'active',
                'current_period_start' => $sub->current_period_start && $sub->status === 'active' ? $sub->current_period_start : $start,
                'current_period_end' => $sub->current_period_end && $sub->current_period_end->gt($end) ? $sub->current_period_end : $end,
                'past_due_at' => null, 'cancelled_at' => null, 'cancel_at_period_end' => false,
            ]);
            AuditLog::record('billing.invoice_paid', $invoice, ['number' => $invoice->number, 'amount' => $invoice->amount, 'method' => $method], $institution->id);
            self::forget();
            \App\Support\Access::forget();

            return $invoice->fresh();
        });
    }

    /**
     * Run daily: moves subscriptions along (trial ended, period ended, grace over), raises renewal invoices and
     * renews free plans. Returns what changed, for the log.
     */
    public static function tick(): array
    {
        $grace = (int) PlatformSettings::get('billing.grace_days', 14);
        $changed = [];

        foreach (Subscription::with(['plan', 'institution'])->whereIn('status', ['trialing', 'active', 'past_due'])->get() as $sub) {
            $ends = $sub->status === 'trialing' ? $sub->trial_ends_at : $sub->current_period_end;

            if (in_array($sub->status, ['trialing', 'active'], true) && $ends && $ends->isPast()) {
                if ($sub->cancel_at_period_end) {
                    $sub->update(['status' => 'cancelled', 'cancelled_at' => now()]);
                    $changed[] = "{$sub->institution?->short_code}: cancelled at the end of its period";
                    continue;
                }
                if ($sub->price() === 0) {
                    // Free (or fully discounted) plan: renews by itself.
                    $from = $ends->copy();
                    $sub->update(['status' => 'active', 'current_period_start' => $from, 'current_period_end' => self::periodEnd($from, $sub->cycle)]);
                    $changed[] = "{$sub->institution?->short_code}: free plan renewed";
                    continue;
                }
                $sub->update(['status' => 'past_due', 'past_due_at' => now()]);
                if (! Invoice::where('institution_id', $sub->institution_id)->where('status', 'open')->exists()) {
                    self::forget();
                    self::invoiceFor($sub->institution, $sub->plan, $sub->cycle);
                }
                AuditLog::record('billing.past_due', $sub->institution, ['was' => $sub->getOriginal('status')], $sub->institution_id);
                $changed[] = "{$sub->institution?->short_code}: payment due";
                continue;
            }

            if ($sub->status === 'past_due' && $sub->past_due_at && $sub->past_due_at->copy()->addDays($grace)->isPast()) {
                $sub->update(['status' => 'expired']);
                AuditLog::record('billing.expired', $sub->institution, ['grace_days' => $grace], $sub->institution_id);
                $changed[] = "{$sub->institution?->short_code}: lapsed after {$grace} days overdue";
            }
        }
        self::forget();
        \App\Support\Access::forget();

        return $changed;
    }

    /** For the admin banner and the subscription page. */
    public static function summary(?Institution $institution): ?array
    {
        $sub = self::subscriptionFor($institution);
        if (! $sub) {
            return null;
        }
        $renews = $sub->renewsAt();
        $grace = (int) PlatformSettings::get('billing.grace_days', 14);

        return [
            'enforced' => self::enforced(),
            'status' => $sub->status,
            'plan' => $sub->plan?->name,
            'cycle' => $sub->cycle,
            'renews_at' => $renews?->toIso8601String(),
            'days_left' => $renews ? (int) max(0, ceil(now()->diffInHours($renews, false) / 24)) : null,
            'grace_ends_at' => $sub->status === 'past_due' && $sub->past_due_at ? $sub->past_due_at->copy()->addDays($grace)->toIso8601String() : null,
            'cancel_at_period_end' => $sub->cancel_at_period_end,
            'reminder_days' => (int) PlatformSettings::get('billing.reminder_days', 7),
        ];
    }
}
