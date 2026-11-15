<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A help page or the design document (Markdown), editable by admins. */
class Page extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'kind', 'slug', 'title', 'body', 'audience', 'position', 'updated_by'];

    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
