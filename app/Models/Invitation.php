<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** A one-time link that lets an invited person (e.g. a parent) choose their password. Only the hash is stored. */
class Invitation extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'user_id', 'token_hash', 'expires_at', 'accepted_at', 'created_by'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'accepted_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array{0: Invitation, 1: string} the invitation and the plain token for the link */
    public static function issue(User $user, ?User $by, int $days = 14): array
    {
        $token = Str::random(48);
        $invite = static::create([
            'institution_id' => $user->institution_id, 'user_id' => $user->id, 'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays($days), 'created_by' => $by?->id,
        ]);

        return [$invite, $token];
    }
}
