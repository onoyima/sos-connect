<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StatusComment extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'status_update_id', 'user_id', 'reply_to_id', 'body'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(StatusComment::class, 'reply_to_id');
    }

    public function status(): BelongsTo
    {
        return $this->belongsTo(StatusUpdate::class, 'status_update_id');
    }
}
