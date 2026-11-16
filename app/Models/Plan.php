<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A package an institution subscribes to: its features, member limit and prices (in the smallest currency unit). */
class Plan extends Model
{
    protected $fillable = ['slug', 'name', 'description', 'price_monthly', 'price_yearly', 'max_members', 'modules', 'trial_days', 'is_public', 'is_active', 'position'];

    protected function casts(): array
    {
        return ['modules' => 'array', 'price_monthly' => 'integer', 'price_yearly' => 'integer', 'max_members' => 'integer',
            'trial_days' => 'integer', 'is_public' => 'boolean', 'is_active' => 'boolean', 'position' => 'integer'];
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(Subscription::class);
    }

    public function price(string $cycle): int
    {
        return $cycle === 'monthly' ? $this->price_monthly : $this->price_yearly;
    }

    public function includes(string $module): bool
    {
        return in_array($module, $this->modules ?? [], true);
    }
}
