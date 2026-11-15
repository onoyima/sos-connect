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

    protected $fillable = ['institution_id', 'user_id', 'body', 'media_path', 'media_type', 'background', 'audience', 'expires_at'];

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

    /** For "chosen groups" and "chosen people": everyone it was shared with. */
    public function audienceUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'status_audience');
    }

    /** People it is hidden from, whatever the audience. */
    public function hiddenFrom(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'status_hidden');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(StatusComment::class);
    }
}
