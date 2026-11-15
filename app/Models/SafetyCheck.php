<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class SafetyCheck extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'created_by', 'title', 'message', 'audience', 'closes_at'];

    protected function casts(): array
    {
        return ['audience' => 'array', 'closes_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::creating(fn (SafetyCheck $c) => $c->uuid ??= (string) Str::uuid());
    }

    public function responses(): HasMany
    {
        return $this->hasMany(SafetyCheckResponse::class);
    }
}
