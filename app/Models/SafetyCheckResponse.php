<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SafetyCheckResponse extends Model
{
    public $timestamps = false;

    protected $fillable = ['safety_check_id', 'user_id', 'answer', 'note', 'lat', 'lng', 'via', 'responded_at'];

    protected function casts(): array
    {
        return ['responded_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
