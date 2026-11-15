<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Device extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['user_id', 'institution_id', 'device_uid', 'platform', 'sign_public_key', 'box_public_key',
        'push_token', 'cert_expires_at', 'last_sync_at', 'revoked_at'];

    protected $hidden = ['push_token'];

    protected function casts(): array
    {
        return ['cert_expires_at' => 'datetime', 'last_sync_at' => 'datetime', 'revoked_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
