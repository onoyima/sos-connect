<?php
/**
 * The institution directory: answers "is this login valid, and who is it?" from the institution's own
 * records database, using a query set from connector/queries/. Plain PHP + PDO, no framework, so it is used both by
 *   - SOS Connect itself (built-in mode: it reads the records database directly, nothing else to run), and
 *   - the standalone connector in connector/public (for institutions that keep their database on their own network).
 */

declare(strict_types=1);

namespace SosConnector;

use PDO;
use Throwable;

final class Directory
{
    private array $config;

    /** Queries rewritten to fit this records database (columns it doesn't have read as empty). */
    private array $fitted = [];

    /** What this database doesn't have, e.g. ["student_academics.studentship", "table vuna_accomodations"]. */
    private array $missing = [];

    /** Without these a query is meaningless, so they're never quietly replaced. */
    private const REQUIRED = ['s.id', 'st.id', 's.password', 'st.password'];

    /** Details that are nice to have: if the records system can't provide them, they are left empty. */
    private const OPTIONAL = ['student_courses', 'staff_courses', 'student_hostel', 'student_guardians', 'current_session'];

    public function __construct(private readonly PDO $pdo, array $config)
    {
        $this->config = $config + [
            'active_status' => [1, '1'],
            'active_studentship' => [1, '1', null],
            // Graduates (level at or above graduated_level) sign in as alumni, unless their studentship is one of these.
            'alumni_blocked_studentship' => [4, '4'], // expelled
            'graduated_level' => 1000,
            'share_guardians' => true,
        ];
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') { // test copies of the database
            $pdo->sqliteCreateFunction('CURDATE', fn () => date('Y-m-d'), 0);
            $pdo->sqliteCreateFunction('CONCAT_WS', fn ($sep, ...$p) => implode($sep, array_filter($p, fn ($x) => $x !== null && $x !== '')), -1);
        }
    }

    /** Builds one from a file of queries, e.g. connector/queries/standard-erp.php. */
    public static function withQueries(PDO $pdo, string $queriesFile, array $config = []): self
    {
        return new self($pdo, ['queries' => require $queriesFile] + $config);
    }

    // ---- What SOS Connect asks -----------------------------------------------------------------

    public function health(): array
    {
        $this->pdo->query('SELECT 1');
        // Run every query once, so a mismatch shows up in the connection test, not when someone signs in.
        $probe = '__sos_connect_probe__';
        foreach (['student_by_login', 'staff_by_login'] as $q) {
            $this->rows($q, $probe);
        }
        foreach (['student_by_id', 'staff_by_id', 'student_courses', 'staff_courses', 'student_hostel', 'student_guardians'] as $q) {
            $this->rows($q, 0);
        }
        $current = $this->row('current_session');

        return ['ok' => true, 'version' => '1.2', 'session' => $current['session'] ?? null, 'semester' => $current['semester'] ?? null,
            'missing' => $this->missing()];
    }

    /** Columns and tables this records database lacks; the app leaves those details empty. */
    public function missing(): array
    {
        return array_values(array_unique($this->missing));
    }

    public function verify(string $login, string $password): array
    {
        $login = trim($login);
        if ($login === '' || $password === '' || strlen($login) > 190) {
            return ['ok' => false, 'reason' => 'invalid_credentials'];
        }
        if ($student = $this->row('student_by_login', $login)) {
            return password_verify($password, (string) $student['password'])
                ? ['ok' => true, 'member' => $this->studentProfile($student)]
                : ['ok' => false, 'reason' => 'invalid_credentials'];
        }
        $staff = $this->row('staff_by_login', $login);
        if ($staff && password_verify($password, (string) $staff['password'])) {
            return ['ok' => true, 'member' => $this->staffProfile($staff)];
        }
        password_verify($password, '$2y$10$81PFGCsBslX9BrsqXFhRneBd3q7X9z0VohUHyZmGutfCbVcQ/.64y'); // similar timing with no account

        return ['ok' => false, 'reason' => 'invalid_credentials'];
    }

    /** $externalId is "st-123" or "sf-45". */
    public function member(string $externalId): array
    {
        if (! preg_match('/^(st|sf)-(\d+)$/', $externalId, $m)) {
            return ['ok' => false, 'reason' => 'not_found'];
        }
        $r = $m[1] === 'st' ? $this->row('student_by_id', (int) $m[2]) : $this->row('staff_by_id', (int) $m[2]);

        return $r ? ['ok' => true, 'member' => $m[1] === 'st' ? $this->studentProfile($r) : $this->staffProfile($r)] : ['ok' => false, 'reason' => 'not_found'];
    }

    public function orgUnits(): array
    {
        return ['ok' => true, 'units' => array_map(fn ($u) => ['type' => $u['type'], 'id' => (string) $u['id'], 'name' => $u['name'],
            'code' => $u['code'] ?? null, 'parent_id' => $u['parent_id'] ? (string) $u['parent_id'] : null], $this->rows('org_units'))];
    }

    public function courses(): array
    {
        return ['ok' => true, 'courses' => array_map(fn ($c) => ['id' => (string) $c['id'], 'code' => $c['code'], 'title' => $c['title'],
            'level' => is_numeric($c['level']) ? (int) $c['level'] : null, 'semester' => is_numeric($c['semester']) ? (int) $c['semester'] : null,
            'department_id' => $c['department_id'] !== null ? (string) $c['department_id'] : null], $this->rows('courses'))];
    }

    // ---- Profiles: only what SOS Connect needs (no photos, addresses, grades, fees or medical records) ----

    /** Studentship codes in the standard layout, used to say why an account can't sign in. */
    private const STUDENTSHIP = [2 => 'deferment', 3 => 'withdrawn', 4 => 'expelled', 5 => 'suspended'];

    private function studentProfile(array $r): array
    {
        $level = is_numeric($r['level'] ?? null) ? (int) $r['level'] : null;
        $graduated = $level !== null && $level >= $this->config['graduated_level'];
        $studentship = $r['studentship'] ?? null;

        if ($graduated) {
            // Alumni: their portal account is often switched off after graduation, so that doesn't stop them here.
            $blocked = $this->inList($studentship, $this->config['alumni_blocked_studentship']);
            $why = $blocked ? (self::STUDENTSHIP[(int) $studentship] ?? 'studentship') : null;
        } else {
            $why = match (true) {
                ! $this->inList($r['status'] ?? null, $this->config['active_status']) => 'status',
                ! $this->inList($studentship, $this->config['active_studentship']) => self::STUDENTSHIP[(int) $studentship] ?? 'studentship',
                default => null,
            };
        }
        [$year, $yearKind] = $this->alumniYear($r);
        $hostel = $graduated ? null : $this->row('student_hostel', $r['id']);

        $profile = [
            'external_id' => 'st-'.$r['id'],
            'type' => $graduated ? 'alumni' : 'student',
            'name' => $this->fullName($r),
            'email' => $r['email'] ?: null,
            'identifier' => $r['matric'] ?: null,
            'phone' => $r['phone'] ?: null,
            'status' => $why === null ? 'active' : 'inactive',
            'inactive_reason' => $why,
            'level' => $level,
            'alumni_year' => $graduated ? $year : null,
            'alumni_year_kind' => $graduated && $year ? $yearKind : null,
            'programme' => $r['programme'] ?? null,
            'faculty' => $this->unitOf($r, 'faculty'),
            'department' => $this->unitOf($r, 'department'),
            'hostel' => $hostel ? ['id' => (string) $hostel['hostel_id'], 'name' => $hostel['hostel_name'], 'room' => $hostel['room'] ?? null] : null,
            'date_of_birth' => $r['dob'] ?? null, // only used to tell if under 18; not stored
            'courses' => $graduated ? [] : $this->courseList('student_courses', $r['id']),
            'guardians' => $graduated || ! $this->config['share_guardians'] ? [] : array_values(array_filter(array_map(fn ($g) => [
                'name' => trim((string) $g['name']), 'relationship' => $g['relationship'] ?: null, 'phone' => $g['phone'] ?: null, 'email' => $g['email'] ?: null,
            ], $this->rows('student_guardians', $r['id'])), fn ($g) => $g['name'] !== '' && ($g['email'] || $g['phone']))),
        ];

        return $profile;
    }

    /**
     * The year an alumnus is grouped by: the graduation year if the records hold one, otherwise the year they
     * started, read from the matric number (".../18/1234" is the 2018 set).
     *
     * @return array{0: ?int, 1: ?string}
     */
    private function alumniYear(array $r): array
    {
        $grad = $r['graduation_year'] ?? null;
        if (is_string($grad) && preg_match('/(19|20)\d{2}/', $grad, $m)) {
            $grad = $m[0];
        }
        if (is_numeric($grad) && (int) $grad >= 1950 && (int) $grad <= (int) date('Y') + 1) {
            return [(int) $grad, 'graduated'];
        }
        if (preg_match('/(?:^|[\/\-])(\d{2}|(?:19|20)\d{2})[\/\-]\d+\s*$/', (string) ($r['matric'] ?? ''), $m)) {
            $y = (int) $m[1];
            $y = $y < 100 ? ($y + 2000 > (int) date('Y') + 1 ? 1900 + $y : 2000 + $y) : $y;

            return [$y, 'entry'];
        }

        return [null, null];
    }

    private function staffProfile(array $r): array
    {
        return [
            'external_id' => 'sf-'.$r['id'],
            'type' => 'staff',
            'name' => $this->fullName($r),
            'email' => $r['email'] ?: null,
            'identifier' => $r['staff_no'] ?: ('STAFF-'.$r['id']),
            'phone' => $r['phone'] ?: null,
            'status' => $this->inList($r['status'] ?? null, $this->config['active_status']) ? 'active' : 'inactive',
            'inactive_reason' => $this->inList($r['status'] ?? null, $this->config['active_status']) ? null : 'status',
            'faculty' => $this->unitOf($r, 'faculty'),
            'department' => $this->unitOf($r, 'department'),
            'admin_department' => $this->unitOf($r, 'admin_department'),
            'position' => $r['position'] ?? null, // job title, display only: roles are given in SOS Connect
            'courses' => $this->courseList('staff_courses', $r['id']),
        ];
    }

    // ---- Helpers ---------------------------------------------------------------------------------

    /**
     * Runs a named query with one value bound to every :name it uses (PDO can't reuse a name).
     *
     * Records systems differ a little even when they look alike. If this database lacks a column the query
     * reads, the query is fitted to it: the column reads as empty (and a "status = 1" filter on it is dropped),
     * and the gap is noted for the connection test. A missing table empties only an optional detail.
     */
    private function rows(string $name, $value = null): array
    {
        $sql = $this->fitted[$name] ?? $this->config['queries'][$name] ?? null;
        if (! $sql) {
            return [];
        }
        for ($attempt = 0; ; $attempt++) {
            try {
                $rows = $this->run($sql, $value);
                $this->fitted[$name] = $sql;

                return $rows;
            } catch (\PDOException $e) {
                $table = $this->missingTableName($e);
                if ($table !== null && $attempt < 25 && ($fitted = $this->withoutTable($sql, $table)) !== $sql) {
                    // An optional table joined in (e.g. programmes) isn't there: its details read as empty.
                    $this->missing[] = 'table '.$table;
                    $sql = $fitted;
                    continue;
                }
                $column = $this->missingColumn($e);
                if ($column !== null && $attempt < 25 && ! in_array($column, self::REQUIRED, true)) {
                    $fitted = $this->withoutColumn($sql, $column);
                    if ($fitted !== $sql) {
                        $this->missing[] = $this->describe($sql, $column);
                        $sql = $fitted;
                        continue;
                    }
                }
                if (in_array($name, self::OPTIONAL, true)) {
                    $this->missing[] = $name.' ('.($this->missingTable($e) ?? 'not readable').')';
                    $this->fitted[$name] = 'SELECT NULL WHERE 1 = 0';

                    return [];
                }
                throw $e;
            }
        }
    }

    private function run(string $sql, $value): array
    {
        preg_match_all('/:([a-z0-9_]+)/', $sql, $m);
        $st = $this->pdo->prepare($sql);
        foreach (array_unique($m[1]) as $param) {
            $st->bindValue(':'.$param, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $st->execute();

        return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** "sa.studentship" from MySQL's "Unknown column 'sa.studentship'" or SQLite's "no such column: sa.studentship". */
    private function missingColumn(\PDOException $e): ?string
    {
        if (preg_match("/Unknown column '([A-Za-z0-9_.]+)'/", $e->getMessage(), $m) || preg_match('/no such column: ([A-Za-z0-9_.]+)/', $e->getMessage(), $m)) {
            return $m[1];
        }

        return null;
    }

    private function missingTable(\PDOException $e): ?string
    {
        if (preg_match("/Table '(?:[^.']+\\.)?([A-Za-z0-9_]+)' doesn't exist/", $e->getMessage(), $m) || preg_match('/no such table: ([A-Za-z0-9_]+)/', $e->getMessage(), $m)) {
            return 'no table '.$m[1];
        }

        return null;
    }

    private function missingTableName(\PDOException $e): ?string
    {
        if (preg_match("/Table '(?:[^.']+\\.)?([A-Za-z0-9_]+)' doesn't exist/", $e->getMessage(), $m) || preg_match('/no such table: ([A-Za-z0-9_]+)/', $e->getMessage(), $m)) {
            return $m[1];
        }

        return null;
    }

    /**
     * Drops "LEFT JOIN <table> <alias> ON ..." for a table this database doesn't have; everything read from it
     * becomes NULL. Only LEFT JOINs: leaving one out never removes rows. Tables the query is built on still fail.
     */
    private function withoutTable(string $sql, string $table): string
    {
        $t = preg_quote($table, '/');
        if (! preg_match('/\\s+LEFT\\s+JOIN\\s+'.$t.'\\s+(?:AS\\s+)?([A-Za-z0-9_]+)\\s+ON\\s+.*?(?=\\s+(?:LEFT\\s+JOIN|JOIN|WHERE|ORDER|GROUP|LIMIT|UNION)\\b|\\s*$)/is', $sql, $m)) {
            return $sql;
        }
        $sql = str_replace($m[0], '', $sql);
        $alias = $m[1];
        foreach (array_unique(preg_match_all('/\\b'.preg_quote($alias, '/').'\\.([A-Za-z0-9_]+)\\b/', $sql, $cols) ? $cols[0] : []) as $ref) {
            $sql = $this->withoutColumn($sql, $ref);
        }

        return $sql;
    }

    /** Rewrites the query so a column this database doesn't have reads as NULL. */
    private function withoutColumn(string $sql, string $column): string
    {
        $q = preg_quote($column, '/');
        $bare = str_contains($column, '.') ? substr($column, strpos($column, '.') + 1) : $column;
        $ref = str_contains($column, '.') ? '\\b'.$q.'\\b' : '(?<![.\\w])'.$q.'\\b';
        // A status filter on a column that doesn't exist means "no filter".
        $sql = preg_replace('/'.$ref.'\\s*=\\s*1\\b/', '1 = 1', $sql);
        // A plain select item keeps its name: "sa.studentship," becomes "NULL AS studentship,".
        $sql = preg_replace('/(SELECT|DISTINCT|,)(\\s*)'.$ref.'(\\s*)(?=,|\\bFROM\\b)/i', '$1$2NULL AS '.$bare.'$3', $sql);
        // Anywhere else (inside COALESCE, joins, "AS" items) it reads as NULL.
        // ("AS name" is the new label from the step above, not the column, so it stays.)
        return preg_replace('/(?<!\\bAS\\s)'.$ref.'/i', 'NULL', $sql);
    }

    /** "sa.studentship" -> "student_academics.studentship", using the query's own FROM/JOIN aliases. */
    private function describe(string $sql, string $column): string
    {
        if (! str_contains($column, '.')) {
            return $column;
        }
        [$alias, $col] = explode('.', $column, 2);
        if (preg_match('/\\b(?:FROM|JOIN)\\s+([A-Za-z0-9_]+)\\s+(?:AS\\s+)?'.preg_quote($alias, '/').'\\b/i', $sql, $m)) {
            return $m[1].'.'.$col;
        }

        return $column;
    }

    private function row(string $name, $value = null): ?array
    {
        return $this->rows($name, $value)[0] ?? null;
    }

    private function inList($value, array $list): bool
    {
        foreach ($list as $v) {
            if ($v === null ? $value === null : (string) $v === (string) $value) {
                return true;
            }
        }

        return false;
    }

    private function unitOf(array $r, string $kind): ?array
    {
        return match ($kind) {
            'faculty' => ! empty($r['faculty_id']) ? ['id' => (string) $r['faculty_id'], 'name' => $r['faculty_name'] ?? 'Faculty', 'code' => $r['faculty_code'] ?? null] : null,
            'department' => ! empty($r['department_id']) ? ['id' => (string) $r['department_id'], 'name' => $r['department_name'] ?? 'Department', 'code' => $r['department_code'] ?? null] : null,
            'admin_department' => ! empty($r['admin_department_id']) && empty($r['academic_department_id'])
                ? ['id' => (string) $r['admin_department_id'], 'name' => $r['admin_department_name'] ?? 'Unit'] : null,
            default => null,
        };
    }

    private function courseList(string $name, $id): array
    {
        return array_map(fn ($c) => ['id' => (string) $c['id'], 'code' => (string) $c['code'], 'title' => (string) ($c['title'] ?? $c['code']),
            'level' => is_numeric($c['level'] ?? null) ? (int) $c['level'] : null,
            'department_id' => isset($c['department_id']) ? (string) $c['department_id'] : null], $this->rows($name, $id));
    }

    private function fullName(array $r): string
    {
        return trim(preg_replace('/\s+/', ' ', ($r['fname'] ?? '').' '.($r['mname'] ?? '').' '.($r['lname'] ?? '')));
    }
}
