<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A browser waiting to be linked to someone's phone (QR code on the sign-in page). Not tenant-scoped: it exists before sign-in. */
class WebLink extends Model
{
    protected $fillable = ['code', 'browser', 'user_id', 'status', 'ip', 'agent', 'expires_at', 'approved_at'];

    protected $casts = ['expires_at' => 'datetime', 'approved_at' => 'datetime'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function expired(): bool
    {
        return $this->expires_at->isPast();
    }
}
