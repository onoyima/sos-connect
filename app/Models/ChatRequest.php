<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChatRequest extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'from_id', 'to_id', 'message', 'status', 'responded_at', 'conversation_id'];

    protected function casts(): array
    {
        return ['responded_at' => 'datetime'];
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'from_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'to_id');
    }

    /** Requests between two people, in either direction. */
    public static function between(int $a, int $b): Builder
    {
        return static::query()->where(fn ($q) => $q->where(fn ($w) => $w->where('from_id', $a)->where('to_id', $b))
            ->orWhere(fn ($w) => $w->where('from_id', $b)->where('to_id', $a)));
    }
}
