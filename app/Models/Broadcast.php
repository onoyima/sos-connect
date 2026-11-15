<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use App\Support\Audience;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A pop-up (shown every time the app opens, until paused) or a sliding marquee line, for an audience. */
class Broadcast extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'created_by', 'kind', 'style', 'title', 'body', 'link_url', 'link_label', 'audience', 'starts_at', 'ends_at', 'paused_at'];

    protected function casts(): array
    {
        return ['audience' => 'array', 'starts_at' => 'datetime', 'ends_at' => 'datetime', 'paused_at' => 'datetime'];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Running now: not paused, started, not ended. */
    public function scopeLive(Builder $q): Builder
    {
        return $q->whereNull('paused_at')
            ->where(fn ($w) => $w->whereNull('starts_at')->orWhere('starts_at', '<=', now()))
            ->where(fn ($w) => $w->whereNull('ends_at')->orWhere('ends_at', '>', now()));
    }

    public function state(): string
    {
        return match (true) {
            $this->paused_at !== null => 'paused',
            $this->ends_at && $this->ends_at->isPast() => 'ended',
            $this->starts_at && $this->starts_at->isFuture() => 'scheduled',
            default => 'live',
        };
    }

    public function toClient(): array
    {
        return [
            'id' => $this->id, 'kind' => $this->kind, 'style' => $this->style, 'title' => $this->title, 'body' => $this->body,
            'link_url' => $this->link_url, 'link_label' => $this->link_label,
            // Changes when the message is edited, so a pop-up someone closed shows again after an edit.
            'version' => (string) ($this->updated_at?->getTimestamp() ?? 0),
        ];
    }

    public function isFor(User $u): bool
    {
        return Audience::includes($this->audience ?? ['type' => 'all'], $u);
    }
}
