<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GroupCallParticipant extends Model
{
    public $timestamps = false;

    protected $fillable = ['group_call_id', 'user_id', 'joined_at', 'seen_at', 'left_at'];

    protected function casts(): array
    {
        return ['joined_at' => 'datetime', 'seen_at' => 'datetime', 'left_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
