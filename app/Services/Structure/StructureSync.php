<?php

namespace App\Services\Structure;

use App\Models\Course;
use App\Models\Institution;
use App\Models\OrgUnit;
use App\Services\Connector\ConnectorClient;
use App\Services\Groups\AutoGroupSync;
use App\Support\Access;
use App\Support\CurrentInstitution;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Brings faculties, departments, admin departments, hostels and courses in from the institution's own records,
 * only when asked: an admin presses "Sync from records", or the nightly sync runs (if switched on). Nobody's
 * records are copied in bulk: people are added the first time they sign in, from their own record.
 * Nothing is deleted: units that disappear from the records stay until an admin removes them.
 */
class StructureSync
{
    public function __construct(private readonly AutoGroupSync $groups) {}

    /** Reads the records now (directly or through the connector) and brings in what changed. */
    public function fromRecords(Institution $institution): array
    {
        $connector = $institution->connector ?? throw new RuntimeException('Connect your records first (Admin > Settings).');
        $client = new ConnectorClient($connector);
        $n = $this->import($institution, $client->orgUnits(), $client->courses());
        $institution->update(['settings' => array_merge($institution->settings ?? [], ['structure_synced_at' => now()->toIso8601String()])]);

        return $n;
    }

    /**
     * @param  array<int, array{type:string,id:string,name:string,code:?string,parent_id:?string}>  $units
     * @param  array<int, array{id:string,code:string,title:string,level:?int,semester:?int,department_id:?string}>  $courses
     */
    public function import(Institution $institution, array $units, array $courses): array
    {
        $counts = CurrentInstitution::as($institution->id, function () use ($institution, $units, $courses) {
            return DB::transaction(function () use ($institution, $units, $courses) {
                $n = ['faculty' => 0, 'department' => 0, 'admin_department' => 0, 'hostel' => 0, 'courses' => 0, 'skipped' => 0];
                $ids = [];
                // Faculties first so departments can point at them.
                usort($units, fn ($a, $b) => ($a['type'] === 'faculty' ? 0 : 1) <=> ($b['type'] === 'faculty' ? 0 : 1));
                foreach ($units as $u) {
                    if (! isset($n[$u['type']]) || trim((string) $u['name']) === '') {
                        continue;
                    }
                    $parent = $u['type'] === 'department' && $u['parent_id'] ? ($ids['faculty:'.$u['parent_id']] ?? null) : null;
                    $ids[$u['type'].':'.$u['id']] = $this->unit($institution, $u, $parent)->id;
                    $n[$u['type']]++;
                }

                $seen = [];
                foreach ($courses as $c) {
                    $code = trim(preg_replace('/\s+/', ' ', (string) $c['code']));
                    if ($code === '' || isset($seen[strtoupper($code)])) {
                        $n['skipped']++; // the same code offered by two departments: the first one wins

                        continue;
                    }
                    $seen[strtoupper($code)] = true;
                    $dept = $c['department_id'] ? ($ids['department:'.$c['department_id']]
                        ?? OrgUnit::where('type', 'department')->where('external_id', $c['department_id'])->value('id')) : null;
                    $course = Course::where('external_id', $c['id'])->first() ?? Course::where('code', $code)->first() ?? new Course;
                    $course->fill(['institution_id' => $institution->id, 'external_id' => $c['id'], 'code' => mb_substr($code, 0, 20),
                        'title' => mb_substr((string) $c['title'], 0, 160), 'level' => $c['level'], 'semester' => $c['semester'],
                        'org_unit_id' => $dept ?? $course->org_unit_id])->save();
                    $n['courses']++;
                }

                return $n;
            });
        });

        Access::forget();
        $counts['groups'] = $this->groups->buildAll($institution);

        return $counts;
    }

    private function unit(Institution $institution, array $u, ?int $parentId): OrgUnit
    {
        // Match the record's id; otherwise adopt a unit made by hand with the same code or name.
        $unit = OrgUnit::where('type', $u['type'])->where('external_id', $u['id'])->first()
            ?? ($u['code'] ? OrgUnit::where('type', $u['type'])->whereNull('external_id')->where('code', $u['code'])->first() : null)
            ?? OrgUnit::where('type', $u['type'])->whereNull('external_id')->where('name', $u['name'])->first()
            ?? new OrgUnit(['institution_id' => $institution->id, 'type' => $u['type']]);
        $unit->fill(['external_id' => $u['id'], 'name' => mb_substr(trim($u['name']), 0, 190), 'code' => $u['code'] ?: $unit->code,
            'parent_id' => $parentId ?? $unit->parent_id])->save();

        return $unit;
    }

    public static function summary(array $n): string
    {
        return sprintf('%d faculties, %d departments, %d admin departments, %d hostels, %d courses%s; %d communities and groups checked.',
            $n['faculty'], $n['department'], $n['admin_department'], $n['hostel'], $n['courses'],
            $n['skipped'] ? " ({$n['skipped']} duplicate course codes skipped)" : '', $n['groups']);
    }
}
