<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

class Institution extends Model
{
    protected $fillable = [
        'name', 'slug', 'short_code', 'country', 'email_domains', 'status', 'contact_name', 'contact_email',
        'contact_phone', 'dpo_name', 'dpo_email', 'security_phone', 'settings', 'dpa_accepted_at',
        'dpa_accepted_by', 'dpa_version', 'verified_at',
    ];

    protected function casts(): array
    {
        return [
            'email_domains' => 'array',
            'settings' => 'array',
            'dpa_accepted_at' => 'datetime',
            'verified_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Institution $i) {
            $i->uuid ??= (string) Str::uuid();
            $i->slug ??= Str::slug($i->name);
        });
    }

    public const DEFAULT_SETTINGS = [
        'allow_foreign_relay' => true,     // phones of other institutions may carry our (encrypted) SOS envelopes
        'student_group_creation' => true,
        'status_audience_max' => 'institution',
        'large_group_posting' => 'admins', // auto groups above 300 members are announcement-only
        'large_group_threshold' => 300,
        'retention_overrides' => [],       // may only shorten config('sos.retention')
        // The school collects parent/guardian consent for under-18 students at admission (NDPA s.31), so they can
        // use chat, calls and status straight away. Off: each one waits until their consent is recorded here.
        'minor_consent_at_admission' => false,
    ];

    public function setting(string $key): mixed
    {
        return ($this->settings ?? [])[$key] ?? self::DEFAULT_SETTINGS[$key] ?? null;
    }

    public function retentionDays(string $kind): int
    {
        $default = (int) config("sos.retention.$kind");
        $override = (int) (($this->setting('retention_overrides') ?? [])[$kind] ?? 0);

        return $override > 0 ? min($override, $default) : $default;
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function connector(): HasOne
    {
        return $this->hasOne(InstitutionConnector::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function orgUnits(): HasMany
    {
        return $this->hasMany(OrgUnit::class);
    }
}
