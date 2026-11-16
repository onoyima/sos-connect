<?php

namespace App\Services\Connector;

use App\Models\InstitutionConnector;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Talks to the small "connector" service each institution runs next to its own database
 * (reference implementation in /connector). Every request and response is signed with
 * HMAC-SHA256 so neither side can be impersonated, and requests older than 5 minutes are refused.
 *
 * Protocol v1
 *   POST /v1/verify          {identifier, password}  -> {ok, member?, reason?}
 *   GET  /v1/member/{id}                             -> {ok, member?}       (re-check status)
 *   GET  /v1/org-units                               -> {ok, units:[{type,id,name,code,parent_id}]}
 *   GET  /v1/health                                  -> {ok, version}
 *
 * Request signature  = hex(HMAC_SHA256(secret, ts \n nonce \n METHOD \n path \n sha256hex(body)))
 * Response signature = hex(HMAC_SHA256(secret, ts \n sha256hex(body)))
 *
 * Direct mode (base_url "direct"): the same questions are answered here, in this app, straight from the
 * institution's records database, using the details its admin saved in Admin > Settings. Nothing else has to run.
 */
class ConnectorClient
{
    public function __construct(private readonly InstitutionConnector $connector) {}

    public function verify(string $identifier, string $password): array
    {
        $res = $this->call('POST', '/v1/verify', ['identifier' => $identifier, 'password' => $password]);
        if (($res['ok'] ?? false) !== true) {
            return ['ok' => false, 'reason' => $res['reason'] ?? 'invalid_credentials'];
        }

        return ['ok' => true, 'member' => MemberProfile::fromArray($res['member'] ?? [])];
    }

    public function member(string $externalId): ?MemberProfile
    {
        $res = $this->call('GET', '/v1/member/'.rawurlencode($externalId));

        return ($res['ok'] ?? false) ? MemberProfile::fromArray($res['member']) : null;
    }

    /** Staff in the records whose name, staff number or email matches (people who may never have signed in). @return MemberProfile[] */
    public function staffSearch(string $q): array
    {
        $res = $this->call('POST', '/v1/staff-search', ['q' => $q]);

        return array_map(fn ($m) => MemberProfile::fromArray($m), ($res['ok'] ?? false) ? ($res['people'] ?? []) : []);
    }

    /** People in the records (kinds: "student" covers alumni too, "staff"). @return MemberProfile[] */
    public function peopleSearch(string $q, array $kinds): array
    {
        $res = $this->call('POST', '/v1/people-search', ['q' => $q, 'kinds' => array_values($kinds)]);

        return array_map(fn ($m) => MemberProfile::fromArray($m), ($res['ok'] ?? false) ? ($res['people'] ?? []) : []);
    }

    public function orgUnits(): array
    {
        $res = $this->call('GET', '/v1/org-units');

        return $res['units'] ?? [];
    }

    public function courses(): array
    {
        $res = $this->call('GET', '/v1/courses');

        return $res['courses'] ?? [];
    }

    public function health(): array
    {
        return $this->call('GET', '/v1/health');
    }

    public const DIRECT = 'direct';

    public function isDirect(): bool
    {
        return $this->connector->base_url === self::DIRECT;
    }

    /** Reads the institution's records database directly, with the settings its admin saved. */
    public static function directoryFor(InstitutionConnector $c): \SosConnector\Directory
    {
        if (! config('sos.connector.allow_direct')) {
            throw new RuntimeException('Direct database access is switched off on this server. Use a separate connector.');
        }
        $db = $c->db_settings ?: throw new RuntimeException('Enter the records database details first.');
        $set = $c->query_set ?: 'standard-erp';
        if (! array_key_exists($set, config('sos.connector.query_sets'))) {
            throw new RuntimeException('Unknown records system.');
        }
        self::refuseOwnDatabase($db);

        $driver = $db['driver'] ?? 'mysql';
        $dsn = match ($driver) {
            'mysql', 'mariadb' => sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'] ?? '127.0.0.1', (int) ($db['port'] ?? 3306), $db['database'] ?? ''),
            'sqlite' => app()->environment('production') ? throw new RuntimeException('Unsupported database.') : 'sqlite:'.($db['database'] ?? ''),
            default => throw new RuntimeException('Unsupported database.'),
        };
        require_once base_path('connector/src/Directory.php');
        $pdo = new \PDO($dsn, $db['username'] ?? null, $db['password'] ?? null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_TIMEOUT => config('sos.connector.connect_timeout'),
        ]);

        return \SosConnector\Directory::withQueries($pdo, base_path("connector/queries/{$set}.php"));
    }

    /** Plain-language reason for the common database connection failures, shown to the admin after "Save and test". */
    private static function explain(\PDOException $e): string
    {
        $msg = $e->getMessage();
        $why = match (true) {
            str_contains($msg, '[1045]') => 'Wrong username or password, or this user may not connect from this server (on hosting, allow it under "Remote MySQL").',
            str_contains($msg, '[1049]') => 'No database with that name on that server.',
            str_contains($msg, '[1044]') => 'That user has no access to that database. Give it read (SELECT) access.',
            str_contains($msg, '[2002]'), str_contains($msg, '[2006]'), str_contains($msg, 'timed out') => 'Could not reach the server. Check the host and port.',
            str_contains($msg, '[1142]'), str_contains($msg, '[42S02]') => 'Connected, but a needed table is missing or not readable. Is this the right database?',
            default => null,
        };

        // Kept short: it's shown on the Settings page and stored with the test result.
        return mb_substr('Records database: '.($why ?? $msg), 0, 240);
    }

    /** The records connection must never point at this app's own database. */
    public static function refuseOwnDatabase(array $db): void
    {
        $own = config('database.connections.'.config('database.default'));
        $sameDb = mb_strtolower((string) ($db['database'] ?? '')) === mb_strtolower((string) ($own['database'] ?? ''));
        $local = fn ($h) => in_array(mb_strtolower((string) $h), ['localhost', '127.0.0.1', '::1', ''], true);
        $sameHost = mb_strtolower((string) ($db['host'] ?? '')) === mb_strtolower((string) ($own['host'] ?? '')) || ($local($db['host'] ?? '') && $local($own['host'] ?? ''));
        if ($sameDb && ($sameHost || ($db['driver'] ?? '') === 'sqlite')) {
            throw new RuntimeException("That is this app's own database. Enter the school's records database.");
        }
    }

    private function call(string $method, string $path, ?array $body = null): array
    {
        if ($this->isDirect()) {
            try {
                $dir = self::directoryFor($this->connector);

                $result = match (true) {
                    $path === '/v1/health' => $dir->health(),
                    $path === '/v1/verify' => $dir->verify((string) ($body['identifier'] ?? ''), (string) ($body['password'] ?? '')),
                    str_starts_with($path, '/v1/member/') => $dir->member(rawurldecode(substr($path, 11))),
                    $path === '/v1/org-units' => $dir->orgUnits(),
                    $path === '/v1/staff-search' => $dir->staffSearch((string) ($body['q'] ?? '')),
                    $path === '/v1/people-search' => $dir->peopleSearch((string) ($body['q'] ?? ''), array_values(array_intersect((array) ($body['kinds'] ?? []), ['student', 'staff']))),
                    $path === '/v1/courses' => $dir->courses(),
                    default => ['ok' => false, 'reason' => 'not_found'],
                };
                if ($dir->missing() && $path !== '/v1/health') {
                    // Not an error: those details stay empty. Logged so the admin can see why, e.g., a hostel is blank.
                    \Illuminate\Support\Facades\Log::info('Records database lacks some details; they are left empty.', ['missing' => $dir->missing()]);
                }

                return $result;
            } catch (\PDOException $e) {
                report($e);
                throw new RuntimeException(self::explain($e), 0, $e);
            }
        }

        $base = rtrim($this->connector->base_url, '/');
        if (config('sos.connector.require_https') && ! str_starts_with($base, 'https://')) {
            throw new RuntimeException('Connector URL must use HTTPS.');
        }

        $raw = $body === null ? '' : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $ts = (string) time();
        $nonce = Str::random(32);
        $signature = hash_hmac('sha256', implode("\n", [$ts, $nonce, $method, $path, hash('sha256', $raw)]), $this->connector->secret);

        if (! app()->runningUnitTests() && ($why = \App\Support\SafeUrl::problem($base))) {
            throw new RuntimeException("Institution connector address refused: {$why}");
        }
        try {
            $response = Http::timeout(config('sos.connector.timeout'))
                ->withOptions(['allow_redirects' => false]) // never follow a redirect somewhere else
                ->withHeaders([
                    'X-SOS-Key' => $this->connector->key_id,
                    'X-SOS-Timestamp' => $ts,
                    'X-SOS-Nonce' => $nonce,
                    'X-SOS-Signature' => $signature,
                    'Accept' => 'application/json',
                ])
                ->withBody($raw, 'application/json')
                ->send($method, $base.$path);
        } catch (ConnectionException $e) {
            throw new RuntimeException('Institution connector unreachable.', 0, $e);
        }

        if ($response->serverError()) {
            throw new RuntimeException('Institution connector error ('.$response->status().').');
        }

        $respTs = (string) $response->header('X-SOS-Timestamp');
        $respSig = (string) $response->header('X-SOS-Signature');
        $expected = hash_hmac('sha256', $respTs."\n".hash('sha256', $response->body()), $this->connector->secret);

        if (! $respSig || ! hash_equals($expected, $respSig)) {
            throw new RuntimeException('Connector response signature invalid.');
        }
        if (abs(time() - (int) $respTs) > config('sos.connector.max_clock_skew')) {
            throw new RuntimeException('Connector response too old; check server clocks.');
        }

        return $response->json() ?? [];
    }
}
