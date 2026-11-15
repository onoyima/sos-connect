<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;

class MeshKey extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'key_id', 'secret', 'active_from', 'retired_at'];

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return ['secret' => 'encrypted', 'active_from' => 'datetime', 'retired_at' => 'datetime'];
    }
}
