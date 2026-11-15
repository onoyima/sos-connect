<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One permission key inside a role. Isolation comes from the role, which belongs to an institution. */
class RolePermission extends Model
{
    public $timestamps = false;

    protected $fillable = ['role_id', 'permission'];

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }
}
