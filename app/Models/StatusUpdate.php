<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StatusUpdate extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'user_id', 'body', 'media_path', 'background', 'audience', 'expires_at'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** People tagged in it. They can see it whoever the audience is, and are told about it. */
    public function mentioned(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'status_mentions');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(StatusComment::class);
    }
}
