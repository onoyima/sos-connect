<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ConversationMember extends Model
{
    public $timestamps = false;

    /** What a group admin can be allowed to do in their group. */
    public const ADMIN_PERMISSIONS = [
        'post' => 'Post when only admins can post',
        'members' => 'Add and remove people',
        'settings' => 'Change name, description and who can post',
        'delete_messages' => "Delete other people's messages",
        'admins' => 'Make other people admins',
    ];

    protected $fillable = ['conversation_id', 'user_id', 'role', 'admin_permissions', 'managed', 'added_by', 'last_read_message_id', 'muted', 'joined_at', 'muted_until', 'archived_at', 'paused_after_message_id'];

    protected function casts(): array
    {
        return ['managed' => 'boolean', 'muted' => 'boolean', 'joined_at' => 'datetime', 'admin_permissions' => 'array',
            'muted_until' => 'datetime', 'archived_at' => 'datetime'];
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    /** Group-admin powers: null admin_permissions means every power. */
    public function allows(string $action): bool
    {
        if (! $this->isAdmin()) {
            return false;
        }

        return $this->admin_permissions === null || in_array($action, $this->admin_permissions, true);
    }

    public function adminPermissionList(): array
    {
        return $this->isAdmin() ? ($this->admin_permissions ?? array_keys(self::ADMIN_PERMISSIONS)) : [];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Muted right now (a timed mute ends by itself). */
    public function isMuted(): bool
    {
        return $this->muted && (! $this->muted_until || $this->muted_until->isFuture());
    }

    /** Members who get alerts and red counts: not muted (or the mute ran out) and not paused. */
    public static function alertable($query)
    {
        return $query->where(fn ($q) => $q->where('muted', false)->orWhere(fn ($r) => $r->whereNotNull('muted_until')->where('muted_until', '<=', now())))
            ->whereNull('paused_after_message_id');
    }
}
