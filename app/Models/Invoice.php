<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Invoice extends Model
{
    public const METHODS = ['bank_transfer' => 'Bank transfer', 'cash' => 'Cash', 'cheque' => 'Cheque', 'waived' => 'Waived (no charge)',
        'paystack' => 'Online (Paystack)', 'other' => 'Other'];

    protected $fillable = ['institution_id', 'plan_id', 'number', 'description', 'cycle', 'amount', 'currency', 'status', 'period_start', 'period_end',
        'due_at', 'paid_at', 'method', 'reference', 'gateway_reference', 'created_by', 'recorded_by', 'notes'];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'period_start' => 'datetime', 'period_end' => 'datetime', 'due_at' => 'datetime', 'paid_at' => 'datetime',
            'institution_id' => 'integer', 'plan_id' => 'integer'];
    }

    public function institution(): BelongsTo
    {
        return $this->belongsTo(Institution::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function toClient(): array
    {
        return [
            'id' => $this->id, 'number' => $this->number, 'description' => $this->description, 'amount' => $this->amount, 'currency' => $this->currency,
            'status' => $this->status, 'cycle' => $this->cycle, 'plan' => $this->plan?->name,
            'period_start' => $this->period_start?->toIso8601String(), 'period_end' => $this->period_end?->toIso8601String(),
            'due_at' => $this->due_at?->toIso8601String(), 'paid_at' => $this->paid_at?->toIso8601String(),
            'method' => $this->method, 'method_label' => $this->method ? (self::METHODS[$this->method] ?? $this->method) : null,
            'reference' => $this->reference, 'overdue' => $this->status === 'open' && $this->due_at?->isPast(),
        ];
    }
}
