<?php

namespace App\Support;

use App\Models\Institution;
use App\Models\OrgUnit;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Models\User;
use App\Models\UserPermission;

/**
 * Answers "may this person do X, and where?".
 *
 * A person's permissions come from:
 *   1. the default role for their kind of account (Student, Staff, Parent), everywhere;
 *   2. roles assigned to them, each over the whole institution or one area, until an optional date;
 *   3. single permissions granted to them directly (also per area);
 * minus single permissions denied to them directly, which beat any role.
 * A super admin role has every permission. Feature switches that are off remove permissions from everyone.
 *
 * Areas nest: a grant over a faculty covers its departments; a grant over a department covers its levels,
 * courses and people. "Area" permissions that are institution-only (settings, roles, audit) count only when
 * given for the whole institution.
 */
final class Access
{
    /** @var array<int, array> compiled grants per user for this request */
    private static array $cache = [];

    /** @var array<int, array<int,?int>> institution id => [unit id => parent id] */
    private static array $trees = [];

    /** Only these work for under-18s until a guardian's consent is recorded (NDPA s.31). */
    public const MINOR_WITHOUT_CONSENT = ['sos.raise', 'announcements.view'];

    public static function forget(?int $userId = null): void
    {
        if ($userId === null) {
            self::$cache = [];
            self::$trees = [];
        } else {
            unset(self::$cache[$userId]);
        }
    }

    /** May the user do this anywhere at all (or, with $unitId, in that area)? */
    public static function can(?User $user, string $permission, ?int $unitId = null): bool
    {
        if (! self::eligible($user, $permission)) {
            return false;
        }
        $c = self::compiled($user);
        if ($c['super']) {
            return true;
        }
        $grant = $c['grants'][$permission] ?? null;
        if (! $grant) {
            return false;
        }
        $deny = $c['denies'][$permission] ?? ['all' => false, 'units' => []];
        if ($deny['all']) {
            return false;
        }

        if ($unitId === null) {
            return $grant['all'] || $grant['units'] !== [];
        }

        $chain = self::ancestors($user->institution_id, $unitId);

        return ($grant['all'] || array_intersect($chain, $grant['units']) !== [])
            && array_intersect($chain, $deny['units']) === [];
    }

    /** True only if the permission covers the entire institution. */
    public static function canEverywhere(?User $user, string $permission): bool
    {
        if (! self::eligible($user, $permission)) {
            return false;
        }
        $c = self::compiled($user);
        if ($c['super']) {
            return true;
        }

        return ($c['grants'][$permission]['all'] ?? false)
            && ! ($c['denies'][$permission]['all'] ?? false)
            && ($c['denies'][$permission]['units'] ?? []) === [];
    }

    /** May the actor do this to that person? (Checks the person's faculty, department and admin unit.) */
    public static function canOnUser(?User $actor, string $permission, User $target): bool
    {
        if (! $actor || $actor->institution_id !== $target->institution_id) {
            return false;
        }
        if (self::canEverywhere($actor, $permission)) {
            return true;
        }
        foreach ($target->unitIds() as $unit) {
            if (self::can($actor, $permission, (int) $unit)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Where the permission applies: null = everywhere, [] = nowhere, otherwise the unit ids
     * (including every unit inside them). Use it to filter lists: $q->whereIn('department_unit_id', $ids).
     */
    public static function units(?User $user, string $permission): ?array
    {
        if (self::canEverywhere($user, $permission)) {
            return null;
        }
        if (! self::can($user, $permission)) {
            return [];
        }
        $tree = self::tree($user->institution_id);
        $ids = [];
        foreach (array_keys($tree) as $unit) {
            if (self::can($user, $permission, $unit)) {
                $ids[] = $unit;
            }
        }

        return $ids;
    }

    /** Every permission the user has somewhere, for the apps to show or hide buttons (the server still checks). */
    public static function list(?User $user): array
    {
        if (! $user) {
            return [];
        }

        return array_values(array_filter(PermissionCatalog::keys(), fn ($p) => self::can($user, $p)));
    }

    /** Where each area permission applies, for screens that need to offer the right choices. */
    public static function areas(User $user): array
    {
        $out = [];
        foreach (PermissionCatalog::keys() as $p) {
            if (PermissionCatalog::isArea($p) && self::can($user, $p)) {
                $units = self::units($user, $p);
                $out[$p] = $units === null ? 'all' : $units;
            }
        }

        return $out;
    }

    public static function isSuper(?User $user): bool
    {
        return $user && $user->isActive() && $user->institution_id && self::compiled($user)['super'];
    }

    /**
     * Ids of active people who hold the permission over a given area (or everywhere when $unitIds is empty).
     * Used to find who should receive an SOS raised by someone in that area.
     *
     * @param  int[]  $unitIds
     * @return int[]
     */
    public static function holders(int $institutionId, string $permission, array $unitIds = []): array
    {
        return CurrentInstitution::as($institutionId, function () use ($institutionId, $permission, $unitIds) {
            $roleIds = Role::query()->where(fn ($q) => $q->where('is_super', true)
                ->orWhereHas('permissions', fn ($p) => $p->where('permission', $permission)))->get(['id', 'default_for']);

            $chains = [];
            foreach ($unitIds as $u) {
                $chains = array_merge($chains, self::ancestors($institutionId, (int) $u));
            }
            $chains = array_values(array_unique($chains));

            $areaFilter = function ($q) use ($chains) {
                $q->whereNull('org_unit_id');
                if ($chains) {
                    $q->orWhereIn('org_unit_id', $chains);
                }
            };

            $candidates = RoleAssignment::query()->whereIn('role_id', $roleIds->pluck('id'))->active()->where($areaFilter)->pluck('user_id')
                ->merge(UserPermission::query()->where('permission', $permission)->where('effect', 'grant')->active()->where($areaFilter)->pluck('user_id'));

            $defaults = $roleIds->pluck('default_for')->filter()->all();
            if ($defaults) {
                $candidates = $candidates->merge(User::inInstitution($institutionId)->whereIn('member_type', $defaults)->where('status', 'active')->pluck('id'));
            }

            $users = User::inInstitution($institutionId)->where('status', 'active')->whereIn('id', $candidates->unique())->get();

            return $users->filter(function (User $u) use ($permission, $unitIds) {
                if (! $unitIds) {
                    return self::canEverywhere($u, $permission);
                }
                foreach ($unitIds as $unit) {
                    if (self::can($u, $permission, (int) $unit)) {
                        return true;
                    }
                }

                return false;
            })->pluck('id')->values()->all();
        });
    }

    /** The unit and every unit above it, nearest first. */
    public static function ancestors(int $institutionId, int $unitId): array
    {
        $tree = self::tree($institutionId);
        $chain = [];
        $seen = [];
        for ($u = $unitId; $u !== null && ! isset($seen[$u]); $u = $tree[$u] ?? null) {
            $seen[$u] = true;
            $chain[] = $u;
        }

        return $chain;
    }

    /** The unit and every unit inside it. */
    public static function descendants(int $institutionId, int $unitId): array
    {
        $tree = self::tree($institutionId);
        $out = [$unitId];
        for ($i = 0; $i < count($out); $i++) {
            foreach ($tree as $child => $parent) {
                if ($parent === $out[$i] && ! in_array($child, $out, true)) {
                    $out[] = $child;
                }
            }
        }

        return $out;
    }

    // ---------------------------------------------------------------------------------------------

    private static function eligible(?User $user, string $permission): bool
    {
        if (! $user || ! $user->isActive() || ! $user->institution_id || $user->member_type === 'relay') {
            return false;
        }
        if ($user->is_minor && ! $user->guardian_consent_at && ! in_array($permission, self::MINOR_WITHOUT_CONSENT, true)
            && ! self::institution($user)?->setting('minor_consent_at_admission')) {
            return false;
        }
        $module = PermissionCatalog::module($permission);

        return $module === null || Modules::enabled(self::institution($user), $module);
    }

    private static function compiled(User $user): array
    {
        return self::$cache[$user->id] ??= CurrentInstitution::as($user->institution_id, function () use ($user) {
            $c = ['super' => false, 'grants' => [], 'denies' => []];

            $assignments = RoleAssignment::query()->where('user_id', $user->id)->active()->get(['role_id', 'org_unit_id']);
            $roles = Role::query()->with('permissions:id,role_id,permission')
                ->where(fn ($q) => $q->whereIn('id', $assignments->pluck('role_id'))->orWhere('default_for', $user->member_type))
                ->get()->keyBy('id');

            $apply = function (string $perm, ?int $unit, string $bucket) use (&$c) {
                if (! PermissionCatalog::exists($perm)) {
                    return;
                }
                if ($unit !== null && ! PermissionCatalog::isArea($perm) && $bucket === 'grants') {
                    return; // institution-only permissions don't count when given for one area
                }
                $c[$bucket][$perm] ??= ['all' => false, 'units' => []];
                if ($unit === null) {
                    $c[$bucket][$perm]['all'] = true;
                } else {
                    $c[$bucket][$perm]['units'][] = $unit;
                }
            };

            foreach ($roles as $role) {
                if ($role->default_for === $user->member_type) {
                    foreach ($role->permissions as $p) {
                        $apply($p->permission, null, 'grants');
                    }
                }
            }
            foreach ($assignments as $a) {
                $role = $roles[$a->role_id] ?? null;
                if (! $role) {
                    continue;
                }
                if ($role->is_super && $a->org_unit_id === null) {
                    $c['super'] = true;
                }
                foreach ($role->permissions as $p) {
                    $apply($p->permission, $a->org_unit_id, 'grants');
                }
            }

            foreach (UserPermission::query()->where('user_id', $user->id)->active()->get(['permission', 'effect', 'org_unit_id']) as $up) {
                $apply($up->permission, $up->org_unit_id, $up->effect === 'deny' ? 'denies' : 'grants');
            }

            return $c;
        });
    }

    private static function tree(int $institutionId): array
    {
        return self::$trees[$institutionId] ??= CurrentInstitution::bypass(fn () => OrgUnit::query()
            ->where('institution_id', $institutionId)->pluck('parent_id', 'id')
            ->map(fn ($p) => $p === null ? null : (int) $p)->all());
    }

    private static function institution(User $user): ?Institution
    {
        return $user->institution; // loaded once per model and kept on it
    }
}
