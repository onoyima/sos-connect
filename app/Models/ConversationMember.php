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

    protected $fillable = ['conversation_id', 'user_id', 'role', 'admin_permissions', 'managed', 'added_by', 'last_read_message_id', 'muted', 'joined_at'];

    protected function casts(): array
    {
        return ['managed' => 'boolean', 'muted' => 'boolean', 'joined_at' => 'datetime', 'admin_permissions' => 'array'];
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
}
