<?php

namespace App\Services\Faces;

use App\Models\FaceCapture;
use App\Models\FaceEnrollment;
use App\Models\FaceExport;
use App\Models\InstitutionConnector;
use App\Models\User;
use App\Services\Connector\ConnectorClient;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use PDO;
use RuntimeException;
use ZipArchive;

/**
 * Sends finished face captures to the school's own systems, in one of two ways:
 *  - an encrypted ZIP (AES-256, password chosen by the admin): a folder per person with the photos, their face points,
 *    and people.csv / people.json listing who is who;
 *  - straight into two tables in the school's database: {prefix}face_people and {prefix}face_images (photos as BLOBs).
 * Both carry the person's ID number and records ID, so the school can match them to its own records.
 */
class FaceExporter
{
    public function __construct(private readonly FaceStore $faces)
    {
    }

    /** @return Collection<int, FaceEnrollment> finished captures to send ("new" = not sent this way before) */
    public function enrollments(string $kind, string $scope): Collection
    {
        $q = FaceEnrollment::where('status', 'complete')->with(['user.department', 'user.faculty', 'user.adminUnit', 'captures'])->orderBy('id');
        if ($scope === 'new') {
            $q->whereNull($kind === 'file' ? 'exported_file_at' : 'exported_db_at');
        }

        return $q->get()->filter(fn (FaceEnrollment $e) => $e->user !== null)->values();
    }

    public function run(FaceExport $export, ?string $password): void
    {
        $export->update(['status' => 'running', 'error' => null]);
        try {
            @set_time_limit(0);
            [$people, $images] = $export->kind === 'file'
                ? $this->buildZip($export, (string) $password)
                : $this->pushToDatabase($export);
            $export->update(['status' => 'done', 'people' => $people, 'images' => $images, 'finished_at' => now()]);
        } catch (\Throwable $e) {
            report($e);
            $export->update(['status' => 'failed', 'error' => mb_substr($this->explain($e), 0, 480), 'finished_at' => now()]);
        }
    }

    // ---- Encrypted ZIP -------------------------------------------------------------------------------------

    /** @return array{0:int,1:int} people, images */
    private function buildZip(FaceExport $export, string $password): array
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('The PHP zip extension is off. Turn on "extension=zip" in php.ini and restart.');
        }
        if (strlen($password) < 8) {
            throw new RuntimeException('Choose a password of at least 8 characters for the file.');
        }
        $list = $this->enrollments('file', $export->scope);
        $dir = "face-exports/{$export->institution_id}";
        Storage::disk('local')->makeDirectory($dir);
        $rel = "{$dir}/faces-{$export->id}-".now()->format('Ymd-His').'.zip';
        $abs = Storage::disk('local')->path($rel);

        $zip = new ZipArchive();
        if ($zip->open($abs, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create the export file on this server.');
        }
        $zip->setPassword($password);
        $add = function (string $name, string $data) use ($zip) {
            $zip->addFromString($name, $data);
            $zip->setEncryptionName($name, ZipArchive::EM_AES_256);
        };

        $rows = [];
        $json = [];
        $images = 0;
        $used = [];
        foreach ($list as $e) {
            $folder = $this->folderName($e->user, $used);
            $p = $this->personRow($e);
            $p['folder'] = $folder;
            $files = [];
            foreach ($e->captures->sortBy(fn ($c) => array_search($c->pose, array_keys(FaceStore::POSES), true)) as $c) {
                $add("{$folder}/{$c->pose}.jpg", $this->faces->image($c));
                $files[] = $this->imageRow($c) + ['file' => "{$folder}/{$c->pose}.jpg"];
                if ($c->landmarks) {
                    $add("{$folder}/{$c->pose}.landmarks.json", $c->landmarks);
                }
                $images++;
            }
            $add("{$folder}/person.json", json_encode($p + ['images' => $files], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $rows[] = $p + ['images' => count($files)];
            $json[] = $p + ['images' => $files];
        }

        $add('people.csv', $this->csv($rows));
        $add('people.json', json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $add('README.txt', $this->readme());
        if (! $zip->close()) {
            throw new RuntimeException('Could not finish the export file (is the disk full?).');
        }

        $export->update(['path' => $rel]);
        FaceEnrollment::whereIn('id', $list->pluck('id'))->update(['exported_file_at' => now()]);

        return [count($rows), $images];
    }

    private function folderName(User $u, array &$used): string
    {
        $base = trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', (string) ($u->identifier ?: 'member-'.$u->id)), '-') ?: 'member-'.$u->id;
        $name = $base;
        for ($i = 2; isset($used[$name]); $i++) {
            $name = "{$base}-{$i}";
        }
        $used[$name] = true;

        return $name;
    }

    private function csv(array $rows): string
    {
        $cols = ['id_number', 'records_id', 'name', 'member_type', 'department', 'faculty', 'level', 'programme', 'captured_at', 'quality', 'liveness_passed', 'images', 'folder', 'sos_capture_id'];
        $h = fopen('php://temp', 'w+');
        fputcsv($h, $cols);
        foreach ($rows as $r) {
            fputcsv($h, array_map(fn ($c) => is_bool($r[$c] ?? null) ? ($r[$c] ? 'yes' : 'no') : ($r[$c] ?? ''), $cols));
        }
        rewind($h);

        return (string) stream_get_contents($h);
    }

    private function readme(): string
    {
        $poses = implode("\n", array_map(fn ($k, $v) => "  {$k}.jpg  - {$v}", array_keys(FaceStore::POSES), FaceStore::POSES));

        return <<<TXT
        SOS Connect face capture export
        ===============================

        people.csv / people.json  Who is who: ID number (matric or staff number), records ID, name, department, when captured.
        <ID number>/              One folder per person:
        {$poses}
          *.landmarks.json        478 face points [x, y, z] for that photo (x and y from 0 to 1 across the photo).
          person.json             The person's details and, for each photo, the head angles and quality measures.

        Every person passed live checks while capturing (blinked twice, opened their mouth, turned their head),
        so these are photos of a real person in front of the camera, not of a printed picture or a screen.
        Photos are JPEG, at least 720 pixels high where the camera allowed, face centred with room around it.

        This file holds biometric data. Keep it encrypted, share the password separately, and delete copies you no longer need.
        Faces change with age: ask people to capture again every few years so the photos stay useful.
        TXT;
    }

    // ---- School database -----------------------------------------------------------------------------------

    /** @return array{0:int,1:int} people, images */
    private function pushToDatabase(FaceExport $export): array
    {
        $target = $this->target($export->institution_id);
        $pdo = self::pdo($target);
        $prefix = $target['prefix'] ?? 'sos_';
        self::ensureTables($pdo, $prefix);
        $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';

        $people = 0;
        $images = 0;
        foreach ($this->enrollments('database', $export->scope) as $e) {
            $p = $this->personRow($e);
            $pdo->beginTransaction();
            try {
                // An older capture of the same person stays in the school's table but is no longer the current one.
                $pdo->prepare("UPDATE {$prefix}face_people SET is_current = 0 WHERE sos_user_id = ? AND sos_enrollment_id <> ?")
                    ->execute([$e->user_id, $e->id]);
                $pdo->prepare("UPDATE {$prefix}face_images SET is_current = 0 WHERE sos_user_id = ? AND sos_enrollment_id <> ?")
                    ->execute([$e->user_id, $e->id]);

                $this->upsert($pdo, $mysql, "{$prefix}face_people", 'sos_enrollment_id', [
                    'sos_enrollment_id' => $e->id, 'sos_user_id' => $e->user_id, 'id_number' => $p['id_number'], 'records_id' => $p['records_id'],
                    'name' => $p['name'], 'member_type' => $p['member_type'], 'department' => $p['department'], 'faculty' => $p['faculty'],
                    'level' => $p['level'], 'programme' => $p['programme'], 'captured_at' => $e->completed_at?->format('Y-m-d H:i:s'),
                    'quality' => $e->quality, 'liveness' => json_encode($e->liveness), 'consent_at' => $e->consent_at?->format('Y-m-d H:i:s'),
                    'is_current' => 1, 'sent_at' => now()->format('Y-m-d H:i:s'),
                ]);
                foreach ($e->captures as $c) {
                    $m = $c->metrics ?? [];
                    $this->upsert($pdo, $mysql, "{$prefix}face_images", 'sos_capture_id', [
                        'sos_capture_id' => $c->id, 'sos_enrollment_id' => $e->id, 'sos_user_id' => $e->user_id,
                        'id_number' => $p['id_number'], 'records_id' => $p['records_id'], 'pose' => $c->pose,
                        'image' => [$this->faces->image($c), PDO::PARAM_LOB], 'mime' => $c->mime, 'width' => $c->width, 'height' => $c->height,
                        'yaw' => $m['yaw'] ?? null, 'pitch' => $m['pitch'] ?? null, 'roll' => $m['roll'] ?? null,
                        'sharpness' => $m['sharpness'] ?? null, 'brightness' => $m['brightness'] ?? null,
                        'sha256' => $c->sha256, 'landmarks' => $c->landmarks, 'is_current' => 1,
                        'captured_at' => $c->created_at?->format('Y-m-d H:i:s'),
                    ]);
                    $images++;
                }
                $pdo->commit();
            } catch (\Throwable $t) {
                $pdo->rollBack();
                throw $t;
            }
            $e->update(['exported_db_at' => now()]);
            $people++;
        }

        return [$people, $images];
    }

    private function upsert(PDO $pdo, bool $mysql, string $table, string $key, array $row): void
    {
        $cols = array_keys($row);
        $marks = implode(', ', array_fill(0, count($cols), '?'));
        $sql = $mysql
            ? "INSERT INTO {$table} (".implode(', ', $cols).") VALUES ({$marks}) ON DUPLICATE KEY UPDATE "
                .implode(', ', array_map(fn ($c) => "{$c} = VALUES({$c})", array_diff($cols, [$key])))
            : "INSERT OR REPLACE INTO {$table} (".implode(', ', $cols).") VALUES ({$marks})";
        $st = $pdo->prepare($sql);
        $i = 1;
        foreach ($row as $v) {
            if (is_array($v)) {
                $st->bindValue($i++, $v[0], $v[1]);
            } else {
                $st->bindValue($i++, $v, $v === null ? PDO::PARAM_NULL : (is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR));
            }
        }
        $st->execute();
    }

    /** The two tables in the school's database (created if they're not there yet). */
    public static function ensureTables(PDO $pdo, string $p): void
    {
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}face_people (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                sos_enrollment_id BIGINT UNSIGNED NOT NULL, sos_user_id BIGINT UNSIGNED NOT NULL,
                id_number VARCHAR(100) NULL, records_id VARCHAR(100) NULL, name VARCHAR(190) NOT NULL, member_type VARCHAR(20) NULL,
                department VARCHAR(190) NULL, faculty VARCHAR(190) NULL, level INT NULL, programme VARCHAR(190) NULL,
                captured_at DATETIME NULL, quality DECIMAL(5,2) NULL, liveness TEXT NULL, consent_at DATETIME NULL,
                is_current TINYINT(1) NOT NULL DEFAULT 1, sent_at DATETIME NULL,
                UNIQUE KEY {$p}face_people_enrollment (sos_enrollment_id), KEY {$p}face_people_id_number (id_number),
                KEY {$p}face_people_records_id (records_id), KEY {$p}face_people_user (sos_user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}face_images (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                sos_capture_id BIGINT UNSIGNED NOT NULL, sos_enrollment_id BIGINT UNSIGNED NOT NULL, sos_user_id BIGINT UNSIGNED NOT NULL,
                id_number VARCHAR(100) NULL, records_id VARCHAR(100) NULL, pose VARCHAR(20) NOT NULL,
                image LONGBLOB NOT NULL, mime VARCHAR(40) NOT NULL, width INT NOT NULL, height INT NOT NULL,
                yaw DECIMAL(8,3) NULL, pitch DECIMAL(8,3) NULL, roll DECIMAL(8,3) NULL, sharpness DECIMAL(10,3) NULL, brightness DECIMAL(8,3) NULL,
                sha256 CHAR(64) NOT NULL, landmarks LONGTEXT NULL, is_current TINYINT(1) NOT NULL DEFAULT 1, captured_at DATETIME NULL,
                UNIQUE KEY {$p}face_images_capture (sos_capture_id), KEY {$p}face_images_enrollment (sos_enrollment_id),
                KEY {$p}face_images_id_number (id_number), KEY {$p}face_images_user (sos_user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

            return;
        }
        // SQLite (test copies only).
        $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}face_people (id INTEGER PRIMARY KEY AUTOINCREMENT, sos_enrollment_id INTEGER NOT NULL UNIQUE,
            sos_user_id INTEGER NOT NULL, id_number TEXT, records_id TEXT, name TEXT NOT NULL, member_type TEXT, department TEXT, faculty TEXT,
            level INTEGER, programme TEXT, captured_at TEXT, quality REAL, liveness TEXT, consent_at TEXT, is_current INTEGER NOT NULL DEFAULT 1, sent_at TEXT)");
        $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}face_images (id INTEGER PRIMARY KEY AUTOINCREMENT, sos_capture_id INTEGER NOT NULL UNIQUE,
            sos_enrollment_id INTEGER NOT NULL, sos_user_id INTEGER NOT NULL, id_number TEXT, records_id TEXT, pose TEXT NOT NULL, image BLOB NOT NULL,
            mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, yaw REAL, pitch REAL, roll REAL, sharpness REAL, brightness REAL,
            sha256 TEXT NOT NULL, landmarks TEXT, is_current INTEGER NOT NULL DEFAULT 1, captured_at TEXT)");
    }

    /** Where "Send to school database" writes, as saved by the admin. */
    public function target(int $institutionId): array
    {
        $c = InstitutionConnector::where('institution_id', $institutionId)->first();
        $t = $c?->face_db_settings;
        if (! $t || empty($t['database'])) {
            throw new RuntimeException('Enter the school database details for face data first.');
        }

        return $t;
    }

    public static function pdo(array $db): PDO
    {
        ConnectorClient::refuseOwnDatabase($db);
        $driver = $db['driver'] ?? 'mysql';
        $dsn = match ($driver) {
            'mysql', 'mariadb' => sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'] ?? '127.0.0.1', (int) ($db['port'] ?? 3306), $db['database'] ?? ''),
            'sqlite' => app()->environment('production') ? throw new RuntimeException('Unsupported database.') : 'sqlite:'.($db['database'] ?? ''),
            default => throw new RuntimeException('Unsupported database.'),
        };

        return new PDO($dsn, $db['username'] ?? null, $db['password'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 10,
        ]);
    }

    /** Connects, creates the tables if needed, and says how many people are already there. */
    public function test(array $db): string
    {
        $pdo = self::pdo($db);
        $p = $db['prefix'] ?? 'sos_';
        self::ensureTables($pdo, $p);
        $n = (int) $pdo->query("SELECT COUNT(*) FROM {$p}face_people")->fetchColumn();

        return "Connected. Tables {$p}face_people and {$p}face_images are ready ({$n} people in them now).";
    }

    public function explain(\Throwable $e): string
    {
        $msg = $e->getMessage();
        if ($e instanceof \PDOException) {
            return 'School database: '.match (true) {
                str_contains($msg, '[1045]') => 'Wrong username or password, or this user may not connect from this server.',
                str_contains($msg, '[1049]') => 'No database with that name on that server.',
                str_contains($msg, '[1044]'), str_contains($msg, '[1142]') => 'That user may not create tables or write here. Give it CREATE, INSERT and UPDATE on this database.',
                str_contains($msg, '[2002]'), str_contains($msg, '[2006]'), str_contains($msg, 'timed out') => 'Could not reach the server. Check the host and port.',
                str_contains($msg, '[1153]'), str_contains($msg, 'max_allowed_packet') => 'A photo is larger than the database allows. Raise max_allowed_packet to at least 16M.',
                default => $msg,
            };
        }

        return $msg;
    }

    // ---- Shared ---------------------------------------------------------------------------------------------

    private function personRow(FaceEnrollment $e): array
    {
        $u = $e->user;
        $live = $e->liveness ?? [];

        return [
            'sos_capture_id' => $e->id, 'id_number' => $u->identifier, 'records_id' => $u->external_id, 'name' => $u->name,
            'member_type' => $u->member_type, 'department' => $u->department?->name ?? $u->adminUnit?->name, 'faculty' => $u->faculty?->name,
            'level' => $u->member_type === 'student' ? $u->level : null, 'programme' => $u->programme,
            'captured_at' => $e->completed_at?->toIso8601String(), 'quality' => $e->quality,
            'liveness_passed' => ($live['blinks'] ?? 0) >= 2 && ! empty($live['mouth']) && ! empty($live['turns']),
        ];
    }

    private function imageRow(FaceCapture $c): array
    {
        return ['pose' => $c->pose, 'width' => $c->width, 'height' => $c->height, 'bytes' => $c->bytes, 'sha256' => $c->sha256, 'measures' => $c->metrics];
    }
}
