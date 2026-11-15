<?php

namespace App\Services\Auth;

use App\Models\AuditLog;
use App\Models\Course;
use App\Models\Institution;
use App\Models\OrgUnit;
use App\Models\User;
use App\Services\Access\RoleManager;
use App\Services\Connector\ConnectorClient;
use App\Services\Connector\MemberProfile;
use App\Services\Groups\AutoGroupSync;
use App\Support\CurrentInstitution;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

/**
 * Logs a person in with the username and password they already use at their institution.
 * The password is forwarded once to the institution's connector over HTTPS and is never stored or logged.
 */
class InstitutionLogin
{
    /** Wrong details, unknown account, or a school that isn't ready: all look the same from outside. */
    public const INVALID = 'invalid';

    public function __construct(
        private readonly AutoGroupSync $groups,
        private readonly RoleManager $roles,
        private readonly \App\Services\Parents\GuardianImport $guardians,
    ) {}

    /** @return array{ok:bool, user?:User, error?:string} */
    public function attempt(Institution $institution, string $identifier, string $password): array
    {
        $identifier = trim($identifier);
        if ($institution->status === 'suspended') {
            return ['ok' => false, 'error' => self::INVALID];
        }

        // 1. Local accounts (institution admins created at onboarding).
        $local = User::inInstitution($institution->id)->where('auth_source', 'local')
            ->where('email', mb_strtolower($identifier))->first();
        if ($local) {
            if ($local->status !== 'active' || ! Hash::check($password, (string) $local->password)) {
                return ['ok' => false, 'error' => self::INVALID];
            }
            if ($institution->isActive()) {
                $this->groups->sync($local); // parents and demo accounts join their groups too
            }

            return ['ok' => true, 'user' => $local];
        }

        // 2. Members, verified by the institution's own system (only once the institution is verified and active).
        $connector = $institution->connector;
        if (! $institution->isActive() || ! $connector) {
            return ['ok' => false, 'error' => self::INVALID];
        }

        try {
            $result = (new ConnectorClient($connector))->verify($identifier, $password);
        } catch (RuntimeException $e) {
            report($e);

            return ['ok' => false, 'error' => "We couldn't check your details right now. Try again in a few minutes."];
        }

        if (! $result['ok']) {
            // Same answer whether the account doesn't exist or the password is wrong (no account probing).
            return ['ok' => false, 'error' => self::INVALID];
        }

        /** @var MemberProfile $profile */
        $profile = $result['member'];

        if ($profile->status !== 'active') {
            $this->markLeft($institution, $profile);
            // The admin can see why in the audit log; the person gets a message that tells them what to do.
            AuditLog::record('auth.refused_inactive', null, ['member' => $profile->externalId, 'reason' => $profile->inactiveReason ?? 'status', 'level' => $profile->level], $institution->id);

            return ['ok' => false, 'error' => self::inactiveMessage($profile->inactiveReason)];
        }

        if ($profile->type === 'alumni') {
            // Institutions set up before alumni existed get the Alumni role the first time a graduate signs in.
            $hasRole = CurrentInstitution::as($institution->id, fn () => \App\Models\Role::where('default_for', 'alumni')->exists());
            if (! $hasRole) {
                $this->roles->installDefaults($institution);
            }
        }

        $user = $this->upsertMember($institution, $profile);

        if ($user->status === 'suspended') {
            return ['ok' => false, 'error' => 'This account is suspended. Contact your school.'];
        }

        // Roles are never taken from the records; they're given in SOS Connect (Admin > Roles / Members).
        $this->roles->refreshTitle($user);
        $this->guardians->sync($institution, $user, $profile->guardians);
        // First sign-in puts them in their university, faculty, department, level and course groups;
        // later sign-ins only fix differences (e.g. they moved up a level).
        $this->groups->sync($user, $this->courseIds($institution, $profile));
        AuditLog::record('auth.login', $user, ['via' => 'connector'], $institution->id);

        return ['ok' => true, 'user' => $user];
    }

    /** What a person whose records say they can't sign in is told. */
    public static function inactiveMessage(?string $reason): string
    {
        return match ($reason) {
            'deferment' => "Your school's records show you're on deferment, so you can't sign in until you resume. If you have resumed, ask your school's records office to update your status.",
            'suspended' => "Your school's records show your studentship is suspended, so you can't sign in. Contact your school's student affairs office.",
            'withdrawn', 'expelled' => "Your school's records show you're no longer a student, so you can't sign in. If that's wrong, contact your school's records office.",
            default => "Your school's records show this account isn't active, so you can't sign in. If that's wrong, ask your school's ICT unit to check your portal account.",
        };
    }

    public function upsertMember(Institution $institution, MemberProfile $p): User
    {
        return CurrentInstitution::as($institution->id, function () use ($institution, $p) {
            $faculty = $p->faculty ? $this->unit($institution, 'faculty', $p->faculty, null) : null;
            $dept = $p->department ? $this->unit($institution, 'department', $p->department, $faculty?->id) : null;
            $adminUnit = $p->adminDepartment ? $this->unit($institution, 'admin_department', $p->adminDepartment, null) : null;
            $alumni = $p->type === 'alumni';
            $hostel = ! $alumni && $p->hostel ? $this->unit($institution, 'hostel', ['id' => $p->hostel['id'], 'name' => $p->hostel['name']], null) : null;

            $user = User::inInstitution($institution->id)->where('external_id', $p->externalId)->first()
                ?? new User(['institution_id' => $institution->id, 'external_id' => $p->externalId, 'auth_source' => 'connector']);

            $user->fill([
                'member_type' => $p->type,
                'name' => $p->name,
                'email' => $p->email,
                'identifier' => $p->identifier,
                'phone' => $p->phone,
                'faculty_unit_id' => $faculty?->id,
                'department_unit_id' => $dept?->id,
                'admin_unit_id' => $adminUnit?->id,
                'hostel_unit_id' => $hostel?->id,
                'residence' => ! $alumni && $p->hostel ? trim($p->hostel['name'].($p->hostel['room'] ? ', room '.$p->hostel['room'] : '')) : null,
                'programme' => $p->programme,
                'level' => $p->level,
                'alumni_year' => $alumni ? $p->alumniYear : null,
                'alumni_year_kind' => $alumni ? $p->alumniYearKind : null,
                'is_minor' => $p->isMinor,
                'status' => $user->status === 'suspended' ? 'suspended' : 'active',
                'last_seen_at' => now(),
            ])->save();

            return $user;
        });
    }

    /** Courses named by the connector, created if new, so their groups can be joined. @return int[] */
    private function courseIds(Institution $institution, MemberProfile $p): array
    {
        if (! $p->courses) {
            return [];
        }

        return CurrentInstitution::as($institution->id, function () use ($p) {
            $ids = [];
            foreach ($p->courses as $c) {
                $dept = $c['department_id'] ? OrgUnit::where('type', 'department')->where('external_id', $c['department_id'])->value('id') : null;
                $course = Course::where('external_id', $c['id'])->whereNotNull('external_id')->first()
                    ?? Course::where('code', $c['code'])->first()
                    ?? new Course(['code' => $c['code']]);
                $course->fill(['title' => $c['title'], 'level' => $c['level'], 'external_id' => $c['id'] ?? $course->external_id,
                    'org_unit_id' => $dept ?? $course->org_unit_id])->save();
                $ids[] = $course->id;
            }

            return $ids;
        });
    }

    private function unit(Institution $institution, string $type, array $u, ?int $parentId): OrgUnit
    {
        // Match by the record's id; otherwise adopt a unit set up by hand or by the seeder with the same code or
        // name (so a seeded "PAP / Pure and Applied Physics" becomes the connector's department 12, not a duplicate).
        $unit = OrgUnit::where('type', $type)->where('external_id', $u['id'])->first()
            ?? (! empty($u['code']) ? OrgUnit::where('type', $type)->where('code', $u['code'])->first() : null)
            ?? OrgUnit::where('type', $type)->where('name', $u['name'])->first();
        if ($unit && $unit->external_id !== $u['id']) {
            $unit->update(['external_id' => $u['id']]);
        }
        $unit ??= OrgUnit::create(['institution_id' => $institution->id, 'type' => $type, 'external_id' => $u['id'],
            'name' => $u['name'], 'code' => $u['code'] ?? null, 'parent_id' => $parentId]);
        $code = $u['code'] ?? $unit->code; // don't wipe a code the records don't send
        if ($unit->name !== $u['name'] || $unit->code !== $code) {
            $unit->update(['name' => $u['name'], 'code' => $code]);
        }

        return $unit;
    }

    private function markLeft(Institution $institution, MemberProfile $p): void
    {
        $user = User::inInstitution($institution->id)->where('external_id', $p->externalId)->first();
        if ($user && $user->status === 'active') {
            $user->update(['status' => 'left']);
            $user->tokens()->delete();
            $user->increment('token_version');
            $this->groups->sync($user); // removes managed memberships
        }
    }
}
