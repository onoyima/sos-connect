<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Course;
use App\Models\OrgUnit;
use App\Models\User;
use App\Services\Groups\AutoGroupSync;
use App\Support\Access;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/** Faculties, departments, admin units, hostels and courses. Usually synced from the institution's records. */
class StructureController extends Controller
{
    public function index(Request $request): Response
    {
        $me = $request->user();
        $manageable = Access::units($me, 'units.manage');
        $people = User::inInstitution($me->institution_id)->where('status', 'active')
            ->selectRaw('department_unit_id as unit, count(*) as n')->groupBy('department_unit_id')->pluck('n', 'unit');

        return Inertia::render('Admin/Structure', [
            'units' => OrgUnit::orderBy('name')->get()->map(fn (OrgUnit $u) => [
                'id' => $u->id, 'name' => $u->name, 'code' => $u->code, 'type' => $u->type, 'parent_id' => $u->parent_id,
                'people' => (int) ($people[$u->id] ?? 0),
                'can_manage' => $manageable === null || in_array($u->id, $manageable, true),
            ]),
            'courses' => Course::orderBy('code')->get(['id', 'code', 'title', 'level', 'semester', 'org_unit_id']),
            'types' => OrgUnit::TYPES,
            'can' => ['manage' => Access::can($me, 'units.manage'), 'everywhere' => $manageable === null],
        ]);
    }

    public function saveUnit(Request $request, ?OrgUnit $unit = null): RedirectResponse
    {
        $me = $request->user();
        $unit = $unit?->exists ? $unit : null; // POST to create: Laravel passes an empty model, not null
        $data = $request->validate(['name' => 'required|string|max:160', 'code' => 'nullable|string|max:30',
            'type' => 'required|in:'.implode(',', array_keys(OrgUnit::TYPES)), 'parent_id' => 'nullable|integer']);
        $parent = $data['parent_id'] ? OrgUnit::findOrFail($data['parent_id']) : null;
        // New top-level areas need the power everywhere; new sub-areas need it over the parent.
        $where = $unit?->id ?? $parent?->id;
        abort_unless($where ? Access::can($me, 'units.manage', $where) : Access::canEverywhere($me, 'units.manage'), 403);
        abort_if($unit && $parent && in_array($unit->id, Access::ancestors($me->institution_id, $parent->id), true), 422, 'An area can\'t sit inside itself.');

        if ($unit) {
            $unit->update(['name' => $data['name'], 'code' => $data['code'], 'type' => $data['type'], 'parent_id' => $parent?->id]);
        } else {
            $unit = OrgUnit::create($data + ['external_id' => 'local-'.Str::lower(Str::random(10))]);
        }
        Access::forget();
        AuditLog::record('unit.saved', $unit, ['name' => $unit->name]);

        return back()->with('status', "Saved {$unit->name}.");
    }

    public function deleteUnit(Request $request, OrgUnit $unit): RedirectResponse
    {
        abort_unless(Access::can($request->user(), 'units.manage', $unit->id), 403);
        $inUse = User::inInstitution($unit->institution_id)->where(fn ($q) => $q->where('department_unit_id', $unit->id)
            ->orWhere('faculty_unit_id', $unit->id)->orWhere('admin_unit_id', $unit->id))->exists();
        abort_if($inUse || $unit->children()->exists(), 422, 'Move the people and areas inside it first.');
        $unit->delete();
        Access::forget();
        AuditLog::record('unit.deleted', null, ['name' => $unit->name]);

        return back()->with('status', "Deleted {$unit->name}.");
    }

    public function saveCourse(Request $request, ?Course $course = null): RedirectResponse
    {
        $me = $request->user();
        $course = $course?->exists ? $course : null;
        $data = $request->validate(['code' => 'required|string|max:20', 'title' => 'required|string|max:160', 'level' => 'nullable|integer|min:100|max:900',
            'semester' => 'nullable|integer|in:1,2', 'org_unit_id' => 'required|integer']);
        abort_unless(Access::can($me, 'units.manage', (int) $data['org_unit_id']), 403);
        $data['code'] = strtoupper(trim($data['code']));
        $course ? $course->update($data) : $course = Course::create($data);
        AuditLog::record('course.saved', $course, ['code' => $course->code]);

        return back()->with('status', "Saved {$course->code}.");
    }

    public function deleteCourse(Request $request, Course $course): RedirectResponse
    {
        abort_unless($course->org_unit_id && Access::can($request->user(), 'units.manage', $course->org_unit_id), 403);
        $course->delete();

        return back()->with('status', "Deleted {$course->code}.");
    }

    /** Imports faculties, departments, admin departments, hostels and courses from the records, through the connector. */
    public function syncFromRecords(Request $request, \App\Services\Structure\StructureSync $sync): RedirectResponse
    {
        abort_unless(Access::canEverywhere($request->user(), 'units.manage'), 403);
        try {
            $n = $sync->fromRecords($request->user()->institution);
        } catch (\Throwable $e) {
            report($e);

            return back()->with('status', 'Could not read the records: '.$e->getMessage());
        }
        AuditLog::record('structure.synced', null, $n);

        return back()->with('status', 'Brought in from the records: '.\App\Services\Structure\StructureSync::summary($n));
    }

    /** Creates every community and group now, so they can be set up before people sign in. */
    public function buildGroups(Request $request, AutoGroupSync $groups): RedirectResponse
    {
        abort_unless(Access::canEverywhere($request->user(), 'units.manage'), 403);
        $n = $groups->buildAll($request->user()->institution);
        AuditLog::record('groups.built', null, ['count' => $n]);

        return back()->with('status', "Communities and groups are ready ({$n} checked). People are added as they sign in.");
    }
}
