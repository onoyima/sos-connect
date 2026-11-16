<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountDeletion extends Model
{
    protected $fillable = ['institution_id', 'user_id', 'requested_at', 'source', 'reason', 'previous_status', 'snapshot', 'ip_address',
        'user_agent', 'closed_by', 'data_request_id', 'status', 'restored_at', 'restored_by', 'restore_note'];

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'requested_at' => 'datetime', 'restored_at' => 'datetime', 'user_id' => 'integer', 'institution_id' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function restorer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'restored_by');
    }
}
