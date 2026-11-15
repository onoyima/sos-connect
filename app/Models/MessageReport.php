<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;

class MessageReport extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'reporter_id', 'target_type', 'target_id', 'reason', 'status', 'resolved_by', 'resolved_at'];

    protected function casts(): array
    {
        return ['resolved_at' => 'datetime'];
    }
}
