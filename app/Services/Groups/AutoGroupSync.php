<?php

namespace App\Services\Groups;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Course;
use App\Models\Institution;
use App\Models\OrgUnit;
use App\Models\User;
use App\Support\CurrentInstitution;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Builds the institution's communities and puts each person in the groups that match their records.
 *
 *   <Institution name> (community)
 *   ├─ Announcements · General · All Students · All Staff · Parents
 *   ├─ Faculty of Natural and Applied Sciences (community)
 *   │  ├─ Announcements · General · Students · Staff
 *   │  └─ Pure and Applied Physics (community)
 *   │     ├─ Announcements · General · Students · Staff
 *   │     ├─ 100 Level Physics, 200 Level Physics …
 *   │     └─ PHY 101 General Physics I … (course groups)
 *   ├─ Administration (community)
 *   │  └─ ICT Staff · Bursary Staff · Internal Audit Staff …
 *   ├─ Hostels (community)
 *   │  └─ Hall A Residents … (from the accommodation records, current session)
 *   └─ Alumni (community): graduates, level 1000 and above in the records
 *      └─ All Alumni · Class of 2023 (or "2019 Set" when only the start year is known) · Physics Alumni …
 *
 * People only see the communities and groups they belong to. Students go in students groups, staff in
 * staff groups, everyone in general groups. Every group is found by a stable key, so renaming a department
 * renames its groups instead of creating new ones. Syncing is a diff: it adds what's missing and removes
 * only memberships it created itself; groups people joined or were added to by hand are never touched.
 */
class AutoGroupSync
{
    /**
     * @param  int[]|null  $courseIds  courses from the institution's records; null = leave course groups as they are
     */
    public function sync(User $user, ?array $courseIds = null): void
    {
        if (! $user->institution_id || in_array($user->member_type, ['relay'], true)) {
            return;
        }

        CurrentInstitution::as($user->institution_id, function () use ($user, $courseIds) {
            $targets = $user->isActive() ? $this->targetsFor($user, $courseIds ?? []) : [];

            DB::transaction(function () use ($user, $targets, $courseIds) {
                $wanted = [];
                foreach ($targets as $t) {
                    $wanted[] = $this->ensure($user->institution, $t)->id;
                }

                $current = ConversationMember::query()->where('user_id', $user->id)->where('managed', true)
                    ->join('conversations', 'conversations.id', '=', 'conversation_members.conversation_id')
                    ->get(['conversation_members.conversation_id', 'conversations.auto_type']);

                // Course groups are only re-checked when the records actually listed courses this time.
                $removable = $current->filter(fn ($m) => $courseIds !== null || $m->auto_type !== 'course')->pluck('conversation_id')->all();
                $toRemove = array_diff($removable, $wanted);
                if ($toRemove) {
                    ConversationMember::where('user_id', $user->id)->where('managed', true)->whereIn('conversation_id', $toRemove)->delete();
                }

                foreach (array_diff($wanted, $current->pluck('conversation_id')->all()) as $cid) {
                    // Joining a group with history: earlier messages are there to read, but don't count as unread.
                    ConversationMember::firstOrCreate(
                        ['conversation_id' => $cid, 'user_id' => $user->id],
                        ['role' => 'member', 'managed' => true, 'joined_at' => now(), 'last_read_message_id' => \App\Models\Message::where('conversation_id', $cid)->max('id')],
                    );
                }

                $this->syncClassRep($user);
            });
        });
    }

    /** Creates every community and standing group up front, so admins can set them up before anyone signs in. */
    public function buildAll(Institution $institution): int
    {
        return CurrentInstitution::as($institution->id, function () use ($institution) {
            $made = 0;
            $all = fn (array $list) => array_map(function ($t) use ($institution, &$made) {
                $this->ensure($institution, $t);
                $made++;
            }, $list);

            $all($this->institutionGroups($institution, null, true));
            foreach (OrgUnit::where('type', 'faculty')->get() as $f) {
                $all($this->facultyGroups($institution, $f, null, true));
            }
            foreach (OrgUnit::where('type', 'department')->get() as $d) {
                $all($this->departmentGroups($institution, $d, null, true));
            }
            foreach (OrgUnit::where('type', 'admin_department')->get() as $u) {
                $all($this->adminUnitGroups($institution, $u));
            }
            foreach (Course::with('department')->get() as $c) {
                $all([$this->courseGroup($institution, $c)]);
            }
            foreach (OrgUnit::where('type', 'hostel')->get() as $h) {
                $all($this->hostelGroups($institution, $h));
            }

            return $made;
        });
    }

    /**
     * The standing group with this key (e.g. "dept:12:students", "dept:12:level:200", "fac:3:general"), created
     * with its communities if it doesn't exist yet. Used when bringing in history from the old chat system.
     */
    public function groupForKey(Institution $institution, string $key): ?Conversation
    {
        return CurrentInstitution::as($institution->id, function () use ($institution, $key) {
            $targets = $this->institutionGroups($institution, null, true);
            if (preg_match('/^fac:(\d+)/', $key, $m) && ($f = OrgUnit::where('type', 'faculty')->find($m[1]))) {
                $targets = array_merge($targets, $this->facultyGroups($institution, $f, null, true));
            } elseif (preg_match('/^dept:(\d+)(?::level:(\d+))?/', $key, $m) && ($d = OrgUnit::where('type', 'department')->find($m[1]))) {
                $targets = array_merge($targets, $this->departmentGroups($institution, $d, null, true));
                if (! empty($m[2])) {
                    $targets[] = $this->levelGroup($institution, $d, (int) $m[2]);
                }
            } elseif (preg_match('/^unit:(\d+)/', $key, $m) && ($u = OrgUnit::where('type', 'admin_department')->find($m[1]))) {
                $targets = array_merge($targets, $this->adminUnitGroups($institution, $u));
            }
            $found = null;
            foreach ($targets as $t) {
                $c = $this->ensure($institution, $t);
                if ($t['key'] === $key) {
                    $found = $c;
                }
            }

            return $found;
        });
    }

    /** @return array<int, array> */
    public function targetsFor(User $user, array $courseIds = []): array
    {
        $inst = $user->institution;
        $who = match ($user->member_type) {
            'student' => 'students', 'parent' => 'parents', 'alumni' => 'alumni', default => 'staff',
        };

        $t = $this->institutionGroups($inst, $who);
        if ($who === 'parents') {
            return $t; // parents see the university community, its announcements and the parents group
        }
        if ($who === 'alumni') {
            // Graduates leave the current-student groups and join the alumni ones: all, their year, their department.
            return array_merge($t, $this->alumniGroups($inst, $user));
        }

        $faculty = $user->faculty_unit_id ? OrgUnit::find($user->faculty_unit_id) : null;
        $dept = $user->department_unit_id ? OrgUnit::find($user->department_unit_id) : null;
        $faculty ??= $dept?->parent_id ? OrgUnit::where('id', $dept->parent_id)->where('type', 'faculty')->first() : null;

        if ($faculty) {
            $t = array_merge($t, $this->facultyGroups($inst, $faculty, $who));
        }
        if ($dept) {
            $t = array_merge($t, $this->departmentGroups($inst, $dept, $who));
            if ($who === 'students' && $user->level && $user->level < 1000) {
                $t[] = $this->levelGroup($inst, $dept, (int) $user->level);
            }
        }
        if ($who === 'students' && $user->hostel_unit_id && ($hostel = OrgUnit::find($user->hostel_unit_id))) {
            $t = array_merge($t, $this->hostelGroups($inst, $hostel));
        }
        if ($user->admin_unit_id && ($unit = OrgUnit::find($user->admin_unit_id))) {
            $t = array_merge($t, $this->adminUnitGroups($inst, $unit));
        }
        foreach (Course::with('department')->whereIn('id', $courseIds)->get() as $course) {
            if ($course->department) {
                $t = array_merge($t, $this->departmentCommunityOnly($inst, $course->department));
            }
            $t[] = $this->courseGroup($inst, $course);
        }

        return $t;
    }

    // ---- What groups exist ----------------------------------------------------------------------

    private function institutionGroups(Institution $i, ?string $who, bool $all = false): array
    {
        $name = $i->name;
        $t = [
            $this->g('inst', $name, 'community', 'community', null, 'institution', description: "Everyone at {$i->short_code}."),
            $this->g('inst:announcements', "{$name} Announcements", 'auto_group', 'announcements', 'inst', 'institution', posting: 'admins',
                description: 'Official notices for the whole university. Only people allowed to post notices can write here.'),
        ];
        if ($all || ! in_array($who, ['parents', 'alumni'], true)) {
            $t[] = $this->g('inst:general', "{$name} General", 'auto_group', 'general', 'inst', 'institution', description: 'The whole university, students and staff.');
        }
        if ($all || $who === 'students') {
            $t[] = $this->g('inst:students', "All {$i->short_code} Students", 'auto_group', 'students', 'inst', 'institution');
        }
        if ($all || $who === 'staff') {
            $t[] = $this->g('inst:staff', "All {$i->short_code} Staff", 'auto_group', 'staff', 'inst', 'institution');
        }
        if ($all || $who === 'parents') {
            $t[] = $this->g('inst:parents', "{$i->short_code} Parents and Guardians", 'auto_group', 'parents', 'inst', 'institution');
        }

        return $t;
    }

    private function facultyGroups(Institution $i, OrgUnit $f, ?string $who, bool $all = false): array
    {
        $k = "fac:{$f->id}";
        // "Faculty of Natural and Applied Sciences" -> "Natural and Applied Sciences" for sub-group names.
        $short = trim(preg_replace('/^(Ecclesiastical\s+)?Faculty of\s+/i', '', $f->name)) ?: $f->name;
        $t = [
            $this->g($k, $f->name, 'community', 'community', 'inst', 'faculty', $f->id),
            $this->g("$k:announcements", "{$short} Announcements", 'auto_group', 'announcements', $k, 'faculty', $f->id, posting: 'admins'),
            $this->g("$k:general", "{$f->name} General", 'auto_group', 'general', $k, 'faculty', $f->id),
        ];
        if ($all || $who === 'students') {
            $t[] = $this->g("$k:students", "{$short} Students", 'auto_group', 'students', $k, 'faculty', $f->id);
        }
        if ($all || $who === 'staff') {
            $t[] = $this->g("$k:staff", "{$short} Staff", 'auto_group', 'staff', $k, 'faculty', $f->id);
        }

        return $t;
    }

    private function departmentCommunityOnly(Institution $i, OrgUnit $d): array
    {
        $parent = $d->parent_id && OrgUnit::where('id', $d->parent_id)->where('type', 'faculty')->exists() ? "fac:{$d->parent_id}" : 'inst';
        $out = [];
        if ($parent !== 'inst' && ($f = OrgUnit::find($d->parent_id))) {
            $out[] = $this->g($parent, $f->name, 'community', 'community', 'inst', 'faculty', $f->id);
        }
        $out[] = $this->g("dept:{$d->id}", $d->name, 'community', 'community', $parent, 'department', $d->id);

        return $out;
    }

    private function departmentGroups(Institution $i, OrgUnit $d, ?string $who, bool $all = false): array
    {
        $k = "dept:{$d->id}";
        $t = $this->departmentCommunityOnly($i, $d);
        $t[] = $this->g("$k:announcements", "{$d->name} Announcements", 'auto_group', 'announcements', $k, 'department', $d->id, posting: 'admins');
        $t[] = $this->g("$k:general", "{$d->name} General", 'auto_group', 'general', $k, 'department', $d->id);
        if ($all || $who === 'students') {
            $t[] = $this->g("$k:students", "{$d->name} Students", 'auto_group', 'students', $k, 'department', $d->id);
        }
        if ($all || $who === 'staff') {
            $t[] = $this->g("$k:staff", "{$d->name} Staff", 'auto_group', 'staff', $k, 'department', $d->id);
        }

        return $t;
    }

    private function levelGroup(Institution $i, OrgUnit $d, int $level): array
    {
        return $this->g("dept:{$d->id}:level:{$level}", "{$level} Level {$d->name}", 'auto_group', 'level', "dept:{$d->id}", 'department', $d->id, $level);
    }

    private function alumniGroups(Institution $i, User $user): array
    {
        $t = [
            $this->g('alumni', "{$i->short_code} Alumni", 'community', 'community', 'inst', 'institution', description: 'Graduates of the institution.'),
            $this->g('alumni:all', "All {$i->short_code} Alumni", 'auto_group', 'alumni', 'alumni', 'institution', description: 'Every graduate.'),
        ];
        if ($y = $user->alumni_year) {
            $t[] = $user->alumni_year_kind === 'entry'
                ? $this->g("alumni:set:{$y}", "{$y} Set Alumni", 'auto_group', 'alumni_year', 'alumni', 'institution', description: "Graduates who started in {$y}.")
                : $this->g("alumni:class:{$y}", "Class of {$y} Alumni", 'auto_group', 'alumni_year', 'alumni', 'institution', description: "Graduates of {$y}.");
        }
        if ($user->department_unit_id && ($d = OrgUnit::find($user->department_unit_id))) {
            $t[] = $this->g("alumni:dept:{$d->id}", "{$d->name} Alumni", 'auto_group', 'alumni_department', 'alumni', 'department', $d->id,
                description: "Graduates of {$d->name}.");
        }

        return $t;
    }

    private function adminUnitGroups(Institution $i, OrgUnit $u): array
    {
        return [
            $this->g('admin', 'Administration', 'community', 'community', 'inst', 'institution', description: 'Non-academic units: Registry, Bursary, ICT and others.'),
            $this->g("unit:{$u->id}:staff", "{$u->name} Staff", 'auto_group', 'unit_staff', 'admin', 'admin_department', $u->id),
        ];
    }

    private function hostelGroups(Institution $i, OrgUnit $h): array
    {
        return [
            $this->g('hostels', 'Hostels', 'community', 'community', 'inst', 'institution', description: 'Halls of residence.'),
            $this->g("hostel:{$h->id}", "{$h->name} Residents", 'auto_group', 'hostel', 'hostels', 'hostel', $h->id),
        ];
    }

    /**
     * A class representative is an admin of their own level group who can always post there (even when the group is
     * set to admins-only). Only the admin status this sync gave is taken back when they stop being class rep.
     */
    private function syncClassRep(User $user): void
    {
        if ($user->member_type !== 'student') {
            return;
        }
        $repUnits = \App\Models\RoleAssignment::where('user_id', $user->id)->active()
            ->whereHas('role', fn ($q) => $q->where('slug', 'class_representative'))->pluck('org_unit_id')->all();
        $isRep = $repUnits && (in_array(null, $repUnits, true) || in_array($user->department_unit_id, $repUnits));
        $levelKey = $user->department_unit_id && $user->level ? "dept:{$user->department_unit_id}:level:{$user->level}" : null;

        $memberships = ConversationMember::where('user_id', $user->id)->where('managed', true)
            ->whereIn('conversation_id', Conversation::where('auto_type', 'level')->select('id'))->with('conversation:id,auto_key')->get();
        foreach ($memberships as $m) {
            $shouldLead = $isRep && $m->conversation?->auto_key === $levelKey;
            if ($shouldLead && $m->role !== 'admin') {
                $m->update(['role' => 'admin', 'admin_permissions' => ['post']]);
            } elseif (! $shouldLead && $m->role === 'admin' && ($m->admin_permissions ?? []) === ['post']) {
                $m->update(['role' => 'member', 'admin_permissions' => null]);
            }
        }
    }

    private function courseGroup(Institution $i, Course $c): array
    {
        $parent = $c->department ? "dept:{$c->department->id}" : 'inst';

        return $this->g("course:{$c->id}", "{$c->code}: {$c->title}", 'auto_group', 'course', $parent, 'course', $c->department?->id, $c->level);
    }

    private function g(string $key, string $name, string $type, string $autoType, ?string $parentKey, string $scope, ?int $unit = null,
        ?int $level = null, string $posting = 'everyone', ?string $description = null): array
    {
        return compact('key', 'name', 'type', 'autoType', 'parentKey', 'scope', 'unit', 'level', 'posting', 'description');
    }

    // ---- Making sure a group exists -------------------------------------------------------------

    /** @var array<string,int> key => id, for this request */
    private array $ids = [];

    private function ensure(Institution $institution, array $t): Conversation
    {
        $parentId = null;
        if ($t['parentKey']) {
            $parentId = $this->ids[$institution->id.'|'.$t['parentKey']]
                ?? Conversation::where('auto_key', $t['parentKey'])->value('id');
        }

        $attrs = ['institution_id' => $institution->id, 'auto_key' => $t['key']];
        $values = ['type' => $t['type'], 'auto_type' => $t['autoType'], 'name' => mb_substr($t['name'], 0, 190), 'scope' => $t['scope'],
            'org_unit_id' => $t['unit'], 'level' => $t['level'], 'posting' => $t['posting'], 'parent_id' => $parentId,
            'description' => $t['description']];

        try {
            $group = Conversation::firstOrCreate($attrs, $values);
        } catch (QueryException) {
            $group = Conversation::where($attrs)->firstOrFail(); // created by a parallel sign-in a moment ago
        }

        // Follow renames and moves at the institution, but keep settings admins changed (posting, description, on/off).
        $updates = [];
        if ($group->name !== $values['name'] && ! $group->name_locked) {
            $updates['name'] = $values['name'];
        }
        if ($parentId && $group->parent_id !== $parentId) {
            $updates['parent_id'] = $parentId;
        }
        if ($updates) {
            $group->update($updates);
        }

        $this->ids[$institution->id.'|'.$t['key']] = $group->id;

        return $group;
    }
}
