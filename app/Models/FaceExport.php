<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** An admin sending captured faces to the school: as an encrypted ZIP file, or into the school's database. */
class FaceExport extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'created_by', 'kind', 'scope', 'status', 'people', 'images', 'path', 'error', 'finished_at'];

    protected $hidden = ['path'];

    protected function casts(): array
    {
        return ['finished_at' => 'datetime'];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
