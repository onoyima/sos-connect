<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use App\Support\Access;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Conversation extends Model
{
    use BelongsToInstitution;

    /** Same as the database defaults, so a chat that was just created can be used straight away without reloading it. */
    protected $attributes = ['enabled' => true, 'posting' => 'everyone', 'name_locked' => false];

    protected $fillable = ['institution_id', 'type', 'name', 'description', 'parent_id', 'auto_key', 'auto_type', 'scope',
        'org_unit_id', 'level', 'posting', 'enabled', 'name_locked', 'created_by', 'direct_key', 'last_message_at'];

    protected function casts(): array
    {
        return ['last_message_at' => 'datetime', 'enabled' => 'boolean', 'name_locked' => 'boolean'];
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Conversation::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Conversation::class, 'parent_id');
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'org_unit_id');
    }

    public function isCommunity(): bool
    {
        return $this->type === 'community';
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'conversation_members')
            ->withPivot(['role', 'last_read_message_id', 'muted', 'managed']);
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(ConversationMember::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    public function membershipFor(User $user): ?ConversationMember
    {
        return $this->memberships()->where('user_id', $user->id)->first();
    }

    /**
     * Who may post: everyone in an open group; in an admins-only group (announcement channels, large groups),
     * group admins allowed to post, plus anyone allowed to post notices in this group's area.
     */
    public function canPost(User $user): bool
    {
        if ($this->isCommunity() || ! $this->enabled) {
            return false;
        }
        $m = $this->membershipFor($user);
        if (! $m) {
            return false;
        }
        if ($this->posting === 'everyone') {
            return true;
        }
        if ($m->allows('post')) {
            return true;
        }

        return $this->org_unit_id
            ? Access::can($user, 'announcements.create', $this->org_unit_id)
            : Access::canEverywhere($user, 'announcements.create');
    }

    /**
     * May this person manage the group in this way? Group admins need the matching group-admin permission;
     * institution staff need the matching permission over the group's area.
     * $action: members | settings | delete_messages | admins
     */
    public function manageableBy(User $user, string $action): bool
    {
        if ($this->type === 'direct') {
            return false;
        }
        if ($this->membershipFor($user)?->allows($action)) {
            return true;
        }
        $permission = ['members' => 'groups.members', 'settings' => 'groups.manage', 'delete_messages' => 'messages.delete', 'admins' => 'groups.admins'][$action] ?? null;
        if (! $permission) {
            return false;
        }

        return $this->org_unit_id ? Access::can($user, $permission, $this->org_unit_id) : Access::canEverywhere($user, $permission);
    }

    public static function directKey(int $a, int $b): string
    {
        return min($a, $b).':'.max($a, $b);
    }
}
