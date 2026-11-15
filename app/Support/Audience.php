<?php

namespace App\Support;

use App\Models\OrgUnit;
use App\Models\User;

/**
 * Who a notice or safety check is for:
 *   {"type":"all"} | {"type":"students"} | {"type":"staff"} | {"type":"parents"}
 *   {"type":"unit","id":12,"who":"all|students|staff"}  (a faculty, department or admin unit, and everything inside it)
 * Older {"type":"department"|"faculty","id":12} values are read as "unit".
 */
final class Audience
{
    public static function normalise(array $a): array
    {
        $type = $a['type'] ?? 'all';
        if (in_array($type, ['department', 'faculty'], true)) {
            return ['type' => 'unit', 'id' => (int) ($a['id'] ?? 0), 'who' => 'all'];
        }
        if ($type === 'unit') {
            return ['type' => 'unit', 'id' => (int) ($a['id'] ?? 0), 'who' => in_array($a['who'] ?? 'all', ['students', 'staff'], true) ? $a['who'] : 'all'];
        }

        return ['type' => in_array($type, ['students', 'staff', 'parents'], true) ? $type : 'all'];
    }

    public static function includes(array $a, User $u): bool
    {
        $a = self::normalise($a);

        return match ($a['type']) {
            'all' => true,
            'students' => $u->member_type === 'student',
            'staff' => $u->member_type === 'staff',
            'parents' => $u->member_type === 'parent',
            'unit' => self::whoMatches($a['who'], $u) && self::inUnit($u, $a['id']),
            default => false,
        };
    }

    /** May the actor address this audience with this permission (e.g. announcements.create)? */
    public static function allowed(User $actor, array $a, string $permission): bool
    {
        $a = self::normalise($a);

        return $a['type'] === 'unit'
            ? $a['id'] > 0 && Access::can($actor, $permission, $a['id'])
            : Access::canEverywhere($actor, $permission);
    }

    /** The choices to offer someone in a "Send to" menu. */
    public static function options(User $actor, string $permission): array
    {
        $out = [];
        if (Access::canEverywhere($actor, $permission)) {
            $out[] = ['value' => ['type' => 'all'], 'label' => 'Everyone'];
            $out[] = ['value' => ['type' => 'students'], 'label' => 'All students'];
            $out[] = ['value' => ['type' => 'staff'], 'label' => 'All staff'];
            if (Modules::enabled($actor->institution, 'parents')) {
                $out[] = ['value' => ['type' => 'parents'], 'label' => 'Parents and guardians'];
            }
        }
        $units = Access::units($actor, $permission);
        $query = CurrentInstitution::as($actor->institution_id, fn () => OrgUnit::query()
            ->when($units !== null, fn ($q) => $q->whereIn('id', $units ?: [0]))
            ->whereIn('type', ['faculty', 'department', 'admin_department', 'hostel'])->orderBy('type')->orderBy('name')->get());
        foreach ($query as $u) {
            $out[] = ['value' => ['type' => 'unit', 'id' => $u->id, 'who' => 'all'], 'label' => $u->name, 'group' => OrgUnit::TYPES[$u->type] ?? 'Area'];
            if ($u->type !== 'admin_department' && $u->type !== 'hostel') {
                $out[] = ['value' => ['type' => 'unit', 'id' => $u->id, 'who' => 'students'], 'label' => "{$u->name}: students only", 'group' => OrgUnit::TYPES[$u->type] ?? 'Area'];
                $out[] = ['value' => ['type' => 'unit', 'id' => $u->id, 'who' => 'staff'], 'label' => "{$u->name}: staff only", 'group' => OrgUnit::TYPES[$u->type] ?? 'Area'];
            }
        }

        return $out;
    }

    public static function describe(array $a): string
    {
        $a = self::normalise($a);
        if ($a['type'] !== 'unit') {
            return ['all' => 'Everyone', 'students' => 'All students', 'staff' => 'All staff', 'parents' => 'Parents and guardians'][$a['type']];
        }
        $name = CurrentInstitution::bypass(fn () => OrgUnit::find($a['id'])?->name) ?? 'An area';

        return $name.($a['who'] === 'all' ? '' : " ({$a['who']})");
    }

    private static function whoMatches(string $who, User $u): bool
    {
        return $who === 'all' ? in_array($u->member_type, ['student', 'staff', 'admin'], true) : $u->member_type === rtrim($who, 's');
    }

    private static function inUnit(User $u, int $unitId): bool
    {
        foreach ($u->unitIds() as $own) {
            if (in_array($unitId, Access::ancestors($u->institution_id, (int) $own), true)) {
                return true;
            }
        }

        return false;
    }
}
