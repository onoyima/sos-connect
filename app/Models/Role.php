<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'name', 'slug', 'description', 'is_super', 'is_system', 'default_for', 'dm_protected', 'rank'];

    protected function casts(): array
    {
        return ['is_super' => 'boolean', 'is_system' => 'boolean', 'dm_protected' => 'boolean'];
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(RoleAssignment::class);
    }

    /** @return string[] */
    public function permissionKeys(): array
    {
        return $this->permissions->pluck('permission')->all();
    }
}
