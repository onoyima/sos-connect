<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A faculty, department, admin unit (ICT, Bursary...), hostel or other area of the institution. */
class OrgUnit extends Model
{
    use BelongsToInstitution;

    public const TYPES = [
        'faculty' => 'Faculty',
        'department' => 'Department',
        'admin_department' => 'Admin unit',
        'hostel' => 'Hostel',
        'custom' => 'Other area',
    ];

    protected $fillable = ['institution_id', 'type', 'external_id', 'parent_id', 'name', 'code'];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(OrgUnit::class, 'parent_id');
    }

    public function courses(): HasMany
    {
        return $this->hasMany(Course::class);
    }

    public function label(): string
    {
        return $this->name.($this->code ? " ({$this->code})" : '');
    }
}
