<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * Live updates. Normally they arrive over the websocket server (Laravel Reverb, started by `php artisan sos:serve`).
 * If that server is down or blocked, pages and phones ask "anything new?" every few seconds instead (see
 * PulseController), so nothing waits for a manual refresh. Per-person signals (call ringing, call setup, status
 * activity) are also kept for two minutes so that fallback can deliver them too.
 */
class Realtime
{
    private const KEEP_SECONDS = 120;

    private const KEEP_MAX = 200;

    /** Settings the website and the phone app use to connect, or null when live updates are switched off. */
    public static function clientSettings(): ?array
    {
        $key = config('broadcasting.connections.reverb.key');
        if (config('broadcasting.default') !== 'reverb' || ! $key) {
            return null;
        }
        $host = (string) config('broadcasting.connections.reverb.options.host');
        $public = config('sos.realtime.public_host') ?: (in_array($host, ['127.0.0.1', 'localhost', '0.0.0.0', '::1', ''], true) ? null : $host);

        return [
            'key' => $key,
            // null = "the same address the page or the app is using", which also works from other devices on the Wi-Fi.
            'host' => $public,
            'port' => (int) (config('sos.realtime.public_port') ?: config('broadcasting.connections.reverb.options.port') ?: 8080),
            'scheme' => config('sos.realtime.public_scheme') ?: (config('broadcasting.connections.reverb.options.scheme') ?: 'http'),
        ];
    }

    /** Keeps a copy of a signal for one person; returns its number. */
    public static function remember(int $userId, string $kind, array $payload): int
    {
        $key = "rt:u:{$userId}";
        // A call sends many signals at the same instant (network candidates). Without the lock, two requests
        // read the same list and the second write drops the first signal, so a call could never connect.
        $write = function () use ($key, $kind, $payload) {
            $id = (int) Cache::increment('rt:seq');
            $list = array_values(array_filter(Cache::get($key, []), fn ($s) => $s['at'] > time() - self::KEEP_SECONDS));
            $list[] = ['id' => $id, 'kind' => $kind, 'data' => $payload, 'at' => time()];
            Cache::put($key, array_slice($list, -self::KEEP_MAX), self::KEEP_SECONDS);

            return $id;
        };
        try {
            return (int) Cache::lock("{$key}:lock", 5)->block(3, $write);
        } catch (\Throwable) {
            return (int) $write(); // the cache can't lock (or waited too long): still keep the signal
        }
    }

    /** Signals for this person after the given number. A negative cursor only returns the current number. */
    public static function since(int $userId, int $cursor): array
    {
        $now = (int) Cache::get('rt:seq', 0);
        if ($cursor < 0) {
            return [$now, []];
        }
        $list = array_values(array_filter(Cache::get("rt:u:{$userId}", []), fn ($s) => $s['id'] > $cursor));
        // Move the cursor only past what was actually handed over: a signal numbered just now but not yet saved
        // (another request is still writing it) must not be skipped.
        $next = $list ? max(array_column($list, 'id')) : $cursor;

        return [$next, array_map(fn ($s) => ['id' => $s['id'], 'kind' => $s['kind'], 'data' => $s['data']], $list)];
    }
}
