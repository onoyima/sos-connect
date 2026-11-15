<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Not tenant-scoped on purpose: the gateway that uploads it may belong to any institution. */
class MeshEnvelope extends Model
{
    protected $fillable = ['envelope_id', 'institution_id', 'sender_user_id', 'sender_device_id', 'gateway_user_id', 'type',
        'to_kind', 'to_id', 'payload', 'result', 'processed_at', 'expires_at'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'processed_at' => 'datetime', 'expires_at' => 'datetime'];
    }
}
