<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['institution_id', 'actor_id', 'action', 'target_type', 'target_id', 'meta', 'ip_address'];

    protected function casts(): array
    {
        return ['meta' => 'array'];
    }

    public static function record(string $action, ?Model $target = null, array $meta = [], ?int $institutionId = null): void
    {
        $actor = auth()->user();
        static::create([
            'institution_id' => $institutionId ?? $actor?->institution_id ?? $target?->institution_id ?? null,
            'actor_id' => $actor?->id,
            'action' => $action,
            'target_type' => $target ? class_basename($target) : null,
            'target_id' => $target?->getKey(),
            'meta' => $meta ?: null,
            'ip_address' => request()?->ip(),
        ]);
    }
}
