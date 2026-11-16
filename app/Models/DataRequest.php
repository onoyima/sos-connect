<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataRequest extends Model
{
    protected $fillable = ['institution_id', 'user_id', 'type', 'status', 'details', 'due_at', 'completed_at'];

    protected function casts(): array
    {
        return ['due_at' => 'datetime', 'completed_at' => 'datetime', 'details' => 'encrypted'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
