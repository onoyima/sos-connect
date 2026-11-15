<?php

namespace App\Services\Connector;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * The minimum we accept from an institution about a member (data minimisation). Date of birth is
 * used only to work out whether the member is under 18 and is never stored.
 */
final class MemberProfile
{
    public function __construct(
        public readonly string $externalId,
        public readonly string $type,            // student | staff | alumni (a graduated student)
        public readonly string $name,
        public readonly ?string $email,
        public readonly ?string $identifier,     // matric / staff number
        public readonly ?string $phone,
        public readonly string $status,          // active | inactive
        public readonly ?array $faculty,         // ['id' => '3', 'name' => 'Natural Sciences']
        public readonly ?array $department,      // ['id' => '12', 'name' => 'Computer Science', 'code' => 'CSC']
        public readonly ?array $adminDepartment, // non-academic unit for staff, e.g. Bursary
        public readonly ?int $level,
        public readonly bool $isMinor,
        /** Courses the student takes or the lecturer teaches: [['id'=>'77','code'=>'PHY 101','title'=>'...','level'=>100]] */
        public readonly array $courses = [],
        /** Hostel this session: ['id'=>'3','name'=>'Hall A','room'=>'B12'] */
        public readonly ?array $hostel = null,
        /** Programme of study (students) or position (staff), for display */
        public readonly ?string $programme = null,
        /** Parents / guardians from the records: [['name'=>..,'relationship'=>..,'phone'=>..,'email'=>..]] */
        public readonly array $guardians = [],
        /** Alumni: the year they're grouped by, and whether it's their graduation year or the year they started. */
        public readonly ?int $alumniYear = null,
        public readonly ?string $alumniYearKind = null,
        /** Why the records say the account isn't active: status, deferment, withdrawn, expelled, suspended. */
        public readonly ?string $inactiveReason = null,
    ) {}

    public static function fromArray(array $m): self
    {
        foreach (['external_id', 'type', 'name', 'status'] as $required) {
            if (empty($m[$required])) {
                throw new InvalidArgumentException("Connector response missing member.$required");
            }
        }
        if (! in_array($m['type'], ['student', 'staff', 'alumni'], true)) {
            throw new InvalidArgumentException('member.type must be student, staff or alumni');
        }

        $isMinor = false;
        if (! empty($m['date_of_birth'])) {
            $isMinor = CarbonImmutable::parse($m['date_of_birth'])->addYears(18)->isFuture();
        } elseif (isset($m['is_minor'])) {
            $isMinor = (bool) $m['is_minor'];
        }

        $unit = fn ($u) => is_array($u) && isset($u['id'], $u['name'])
            ? ['id' => (string) $u['id'], 'name' => (string) $u['name'], 'code' => isset($u['code']) ? (string) $u['code'] : null]
            : null;

        $courses = [];
        foreach (is_array($m['courses'] ?? null) ? array_slice($m['courses'], 0, 60) : [] as $c) {
            if (is_array($c) && ! empty($c['code'])) {
                $courses[] = ['id' => isset($c['id']) ? (string) $c['id'] : null, 'code' => mb_substr(strtoupper(trim((string) $c['code'])), 0, 20),
                    'title' => mb_substr((string) ($c['title'] ?? $c['code']), 0, 160), 'level' => isset($c['level']) ? (int) $c['level'] : null,
                    'department_id' => isset($c['department_id']) ? (string) $c['department_id'] : null];
            }
        }

        return new self(
            externalId: (string) $m['external_id'],
            type: $m['type'],
            name: mb_substr(trim((string) $m['name']), 0, 120),
            email: isset($m['email']) ? mb_strtolower(trim((string) $m['email'])) : null,
            identifier: isset($m['identifier']) ? (string) $m['identifier'] : null,
            phone: isset($m['phone']) ? (string) $m['phone'] : null,
            status: $m['status'] === 'active' ? 'active' : 'inactive',
            faculty: $unit($m['faculty'] ?? null),
            department: $unit($m['department'] ?? null),
            adminDepartment: $unit($m['admin_department'] ?? null),
            level: isset($m['level']) && is_numeric($m['level']) ? (int) $m['level'] : null,
            isMinor: $isMinor,
            courses: $courses,
            hostel: is_array($m['hostel'] ?? null) && isset($m['hostel']['id'], $m['hostel']['name'])
                ? ['id' => (string) $m['hostel']['id'], 'name' => mb_substr((string) $m['hostel']['name'], 0, 120), 'room' => isset($m['hostel']['room']) ? mb_substr((string) $m['hostel']['room'], 0, 30) : null]
                : null,
            programme: isset($m['programme']) ? mb_substr((string) $m['programme'], 0, 160) : (isset($m['position']) ? mb_substr((string) $m['position'], 0, 160) : null),
            guardians: array_values(array_filter(array_map(fn ($g) => is_array($g) ? [
                'name' => mb_substr(trim((string) ($g['name'] ?? '')), 0, 120), 'relationship' => isset($g['relationship']) ? mb_substr((string) $g['relationship'], 0, 40) : null,
                'phone' => isset($g['phone']) ? mb_substr((string) $g['phone'], 0, 30) : null, 'email' => isset($g['email']) ? mb_strtolower(trim((string) $g['email'])) : null,
            ] : null, array_slice(is_array($m['guardians'] ?? null) ? $m['guardians'] : [], 0, 4)), fn ($g) => $g && $g['name'] !== '' && ($g['email'] || $g['phone']))),
            alumniYear: isset($m['alumni_year']) && is_numeric($m['alumni_year']) && $m['alumni_year'] >= 1950 && $m['alumni_year'] <= 2200 ? (int) $m['alumni_year'] : null,
            alumniYearKind: in_array($m['alumni_year_kind'] ?? null, ['graduated', 'entry'], true) ? $m['alumni_year_kind'] : null,
            inactiveReason: isset($m['inactive_reason']) ? mb_substr(preg_replace('/[^a-z_]/', '', (string) $m['inactive_reason']), 0, 30) : null,
        );
    }
}
