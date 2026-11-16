<?php
/**
 * SOS Connect institution connector (PHP 8.1+, PDO), for institutions whose records database is on their own network.
 * If SOS Connect can reach the database itself, you don't need this: use the built-in mode instead.
 * Deploy behind HTTPS. Point the web server's document root at this /public folder and keep
 * config.php one level up. Answers only signed requests from SOS Connect.
 */
declare(strict_types=1);

$config = require dirname(__DIR__) . '/config.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');

function respond(array $body, int $status = 200): never
{
    global $config;
    $raw = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $ts = (string) time();
    header('X-SOS-Timestamp: ' . $ts);
    header('X-SOS-Signature: ' . hash_hmac('sha256', $ts . "\n" . hash('sha256', $raw), $config['secret']));
    http_response_code($status);
    echo $raw;
    exit;
}

// --- 1. caller checks -------------------------------------------------------------------------
if ($config['allowed_ips'] && !in_array($_SERVER['REMOTE_ADDR'] ?? '', $config['allowed_ips'], true)) {
    respond(['ok' => false, 'reason' => 'forbidden'], 403);
}
$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$body = file_get_contents('php://input') ?: '';
$ts = $_SERVER['HTTP_X_SOS_TIMESTAMP'] ?? '';
$nonce = $_SERVER['HTTP_X_SOS_NONCE'] ?? '';
$sig = $_SERVER['HTTP_X_SOS_SIGNATURE'] ?? '';
$key = $_SERVER['HTTP_X_SOS_KEY'] ?? '';

if (!hash_equals($config['key_id'], $key) || !ctype_digit($ts) || abs(time() - (int) $ts) > 300 || !preg_match('/^[A-Za-z0-9]{16,64}$/', $nonce)) {
    respond(['ok' => false, 'reason' => 'unauthorised'], 401);
}
$expected = hash_hmac('sha256', implode("\n", [$ts, $nonce, $method, $path, hash('sha256', $body)]), $config['secret']);
if (!hash_equals($expected, $sig)) {
    respond(['ok' => false, 'reason' => 'unauthorised'], 401);
}
// Replay protection: each nonce works once within the 5-minute window.
@mkdir($config['nonce_dir'], 0700, true);
$nonceFile = $config['nonce_dir'] . '/' . $nonce;
if (file_exists($nonceFile)) {
    respond(['ok' => false, 'reason' => 'replay'], 401);
}
touch($nonceFile);
if (random_int(1, 50) === 1) {
    foreach (glob($config['nonce_dir'] . '/*') ?: [] as $f) {
        if (filemtime($f) < time() - 600) @unlink($f);
    }
}

// --- 2. the directory (shared with SOS Connect's built-in mode) ----------------------------------
require dirname(__DIR__) . '/src/Directory.php';

function directory(): SosConnector\Directory
{
    global $config;
    static $dir = null;
    return $dir ??= new SosConnector\Directory(new PDO($config['db']['dsn'], $config['db']['user'], $config['db']['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
    ]), $config);
}

// --- 3. routes --------------------------------------------------------------------------------
try {
    if ($method === 'GET' && $path === '/v1/health') {
        respond(directory()->health());
    }
    if ($method === 'POST' && $path === '/v1/verify') {
        $in = json_decode($body, true) ?: [];
        respond(directory()->verify((string) ($in['identifier'] ?? ''), (string) ($in['password'] ?? '')));
    }
    if ($method === 'GET' && preg_match('#^/v1/member/((?:st|sf)-\d+)$#', $path, $m)) {
        respond(directory()->member($m[1]));
    }
    if ($method === 'POST' && $path === '/v1/people-search') {
        $in = json_decode($body, true) ?: [];
        respond(directory()->peopleSearch((string) ($in['q'] ?? ''), array_values(array_intersect((array) ($in['kinds'] ?? []), ['student', 'staff']))));
    }
    if ($method === 'POST' && $path === '/v1/staff-search') {
        $in = json_decode($body, true) ?: [];
        respond(directory()->staffSearch((string) ($in['q'] ?? '')));
    }
    if ($method === 'GET' && $path === '/v1/org-units') {
        respond(directory()->orgUnits());
    }
    if ($method === 'GET' && $path === '/v1/courses') {
        respond(directory()->courses());
    }

    respond(['ok' => false, 'reason' => 'not_found'], 404);
} catch (Throwable $e) {
    error_log('[sos-connector] ' . $e->getMessage()); // never echo DB errors to the caller
    respond(['ok' => false, 'reason' => 'server_error'], 500);
}
