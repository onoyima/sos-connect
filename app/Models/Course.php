<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Course extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'org_unit_id', 'external_id', 'code', 'title', 'level', 'semester'];

    public function department(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'org_unit_id');
    }

    public function label(): string
    {
        return "{$this->code}: {$this->title}";
    }
}
