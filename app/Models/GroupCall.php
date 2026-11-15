<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GroupCall extends Model
{
    use BelongsToInstitution;

    /** A participant who hasn't checked in for this long has dropped (closed the tab, lost signal). */
    public const STALE_SECONDS = 45;

    protected $fillable = ['institution_id', 'call_uuid', 'conversation_id', 'started_by', 'type', 'started_at', 'ended_at'];

    protected function casts(): array
    {
        return ['started_at' => 'datetime', 'ended_at' => 'datetime'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function starter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'started_by');
    }

    public function participants(): HasMany
    {
        return $this->hasMany(GroupCallParticipant::class);
    }

    /** People in the call right now. */
    public function present(): HasMany
    {
        return $this->participants()->whereNull('left_at')->where('seen_at', '>', now()->subSeconds(self::STALE_SECONDS));
    }
}
