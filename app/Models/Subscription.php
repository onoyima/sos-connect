<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** An institution's plan and where it stands. Not tenant-scoped: the platform team works across institutions. */
class Subscription extends Model
{
    public const LIVE = ['trialing', 'active', 'past_due'];   // features work (past_due = in its grace period)
    public const LAPSED = ['expired', 'cancelled'];

    protected $fillable = ['institution_id', 'plan_id', 'status', 'cycle', 'trial_ends_at', 'current_period_start', 'current_period_end',
        'past_due_at', 'cancelled_at', 'cancel_at_period_end', 'max_members_override', 'price_override', 'notes'];

    protected function casts(): array
    {
        return ['trial_ends_at' => 'datetime', 'current_period_start' => 'datetime', 'current_period_end' => 'datetime',
            'past_due_at' => 'datetime', 'cancelled_at' => 'datetime', 'cancel_at_period_end' => 'boolean',
            'max_members_override' => 'integer', 'price_override' => 'integer', 'institution_id' => 'integer', 'plan_id' => 'integer'];
    }

    public function institution(): BelongsTo
    {
        return $this->belongsTo(Institution::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function isLapsed(): bool
    {
        return in_array($this->status, self::LAPSED, true);
    }

    public function memberLimit(): ?int
    {
        return $this->max_members_override ?? $this->plan?->max_members;
    }

    /** What one cycle costs this institution (a negotiated price wins). */
    public function price(): int
    {
        return $this->price_override ?? (int) $this->plan?->price($this->cycle);
    }

    /** When it next needs paying or deciding: the trial end, or the end of the paid period. */
    public function renewsAt(): ?\Illuminate\Support\Carbon
    {
        return $this->status === 'trialing' ? $this->trial_ends_at : $this->current_period_end;
    }
}
