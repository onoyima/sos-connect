<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class SosAlert extends Model
{
    use BelongsToInstitution;

    public const CATEGORIES = ['medical', 'fire', 'security', 'harassment', 'accident', 'other'];

    public const OPEN_STATES = ['open', 'acknowledged', 'responding'];

    protected $fillable = ['institution_id', 'user_id', 'client_id', 'category', 'message', 'lat', 'lng', 'accuracy_m',
        'location_label', 'status', 'via', 'raised_at', 'acknowledged_at', 'escalated_at', 'resolved_at', 'resolved_by',
        'resolution_note', 'location_blurred_at'];

    protected function casts(): array
    {
        return [
            'lat' => 'float', 'lng' => 'float',
            'raised_at' => 'datetime', 'acknowledged_at' => 'datetime', 'escalated_at' => 'datetime',
            'resolved_at' => 'datetime', 'location_blurred_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(fn (SosAlert $a) => $a->uuid ??= (string) Str::uuid());
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function responses(): HasMany
    {
        return $this->hasMany(SosResponse::class);
    }

    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN_STATES, true);
    }

    /** Your own alerts, plus alerts from people in the areas where you may see SOS alerts. */
    public function scopeVisibleTo(\Illuminate\Database\Eloquent\Builder $q, User $me): \Illuminate\Database\Eloquent\Builder
    {
        $units = \App\Support\Access::units($me, 'sos.view'); // null = everywhere, [] = nowhere

        return $q->where(function ($w) use ($me, $units) {
            $w->where('user_id', $me->id);
            if ($units === null) {
                $w->orWhereRaw('1 = 1');
            } elseif ($units !== []) {
                $w->orWhereIn('user_id', User::inInstitution($me->institution_id)->where(fn ($u) => $u->whereIn('department_unit_id', $units)
                    ->orWhereIn('faculty_unit_id', $units)->orWhereIn('admin_unit_id', $units)->orWhereIn('hostel_unit_id', $units))->select('id'));
            }
        });
    }

    public function toClient(bool $responderView = false): array
    {
        return [
            'id' => $this->id,
            'uuid' => $this->uuid,
            'client_id' => $this->client_id,
            'category' => $this->category,
            'message' => $this->message,
            'lat' => $this->lat,
            'lng' => $this->lng,
            'accuracy_m' => $this->accuracy_m,
            'location_label' => $this->location_label,
            'status' => $this->status,
            'via' => $this->via,
            'raised_at' => $this->raised_at?->toIso8601String(),
            'acknowledged_at' => $this->acknowledged_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'user' => $responderView ? [
                'id' => $this->user?->id,
                'name' => $this->user?->name,
                'identifier' => $this->user?->identifier,
                'phone' => $this->user?->phone,
                'department' => $this->user?->department?->name,
                'residence' => $this->user?->residence, // hostel and room, so responders know where to go
            ] : null,
            'responses' => $this->relationLoaded('responses') ? $this->responses->map(fn ($r) => [
                'action' => $r->action, 'note' => $r->note, 'by' => $r->user?->name, 'at' => $r->created_at?->toIso8601String(),
            ])->all() : [],
        ];
    }
}
