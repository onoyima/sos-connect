<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Users are NOT globally scoped (the auth guard must load them before an institution is known).
 * Always query other users through User::inInstitution($id) or $me->colleagues().
 */
class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'institution_id', 'external_id', 'auth_source', 'member_type', 'name', 'email', 'identifier', 'phone', 'alumni_year', 'alumni_year_kind',
        'password', 'title', 'faculty_unit_id', 'department_unit_id', 'admin_unit_id', 'hostel_unit_id', 'residence', 'programme', 'level', 'status', 'is_minor',
        'guardian_consent_at', 'last_seen_at', 'calls_seen_at', 'policy_version', 'policy_accepted_at',
    ];

    protected $hidden = ['password', 'remember_token', 'token_version', 'web_session_id', 'web_session_ip', 'web_session_agent'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'is_minor' => 'boolean',
            'web_session_at' => 'datetime',
            'is_platform_admin' => 'boolean',
            'guardian_consent_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'policy_accepted_at' => 'datetime',
        ];
    }

    public function scopeInInstitution(Builder $q, int $institutionId): Builder
    {
        return $q->where('institution_id', $institutionId);
    }

    public function colleagues(): Builder
    {
        return static::query()->inInstitution($this->institution_id)->where('status', 'active')->where('member_type', '!=', 'relay');
    }

    public function institution(): BelongsTo
    {
        return $this->belongsTo(Institution::class);
    }

    public function faculty(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'faculty_unit_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'department_unit_id');
    }

    public function adminUnit(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'admin_unit_id');
    }

    public function roleAssignments(): HasMany
    {
        return $this->hasMany(RoleAssignment::class);
    }

    public function directPermissions(): HasMany
    {
        return $this->hasMany(UserPermission::class);
    }

    public function hostel(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'hostel_unit_id');
    }

    /** The areas this person belongs to, nearest first: department, faculty, admin unit, hostel. */
    public function unitIds(): array
    {
        return array_values(array_filter([$this->department_unit_id, $this->faculty_unit_id, $this->admin_unit_id, $this->hostel_unit_id]));
    }

    public function conversations(): BelongsToMany
    {
        return $this->belongsToMany(Conversation::class, 'conversation_members')
            ->withPivot(['role', 'last_read_message_id', 'muted', 'managed']);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    /**
     * What other members see. Never includes email, phone or identifier unless the viewer is staff, and never
     * someone's roles (admin, super admin, HOD, dean…): the role label is only shown to the person who holds it.
     * In a group, members only see who the group admins are (from the group, not from here).
     */
    public function publicProfile(?User $viewer = null): array
    {
        $staffView = $viewer && \App\Support\Access::canOnUser($viewer, 'members.contact', $this);

        return array_filter([
            'id' => $this->id,
            'name' => $this->name,
            'title' => $viewer && $viewer->id === $this->id ? $this->title : null,
            'member_type' => $this->member_type === 'admin' ? 'staff' : $this->member_type,
            'department' => $this->department?->name,
            'level' => $this->member_type === 'student' ? $this->level : null,
            'alumni_year' => $this->member_type === 'alumni' ? $this->alumni_year : null,
            'email' => $staffView ? $this->email : null,
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
        ], fn ($v) => $v !== null);
    }
}
