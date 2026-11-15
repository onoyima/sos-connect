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
        $id = (int) Cache::increment('rt:seq');
        $key = "rt:u:{$userId}";
        $list = array_values(array_filter(Cache::get($key, []), fn ($s) => $s['at'] > time() - self::KEEP_SECONDS));
        $list[] = ['id' => $id, 'kind' => $kind, 'data' => $payload, 'at' => time()];
        Cache::put($key, array_slice($list, -self::KEEP_MAX), self::KEEP_SECONDS);

        return $id;
    }

    /** Signals for this person after the given number. A negative cursor only returns the current number. */
    public static function since(int $userId, int $cursor): array
    {
        $now = (int) Cache::get('rt:seq', 0);
        if ($cursor < 0) {
            return [$now, []];
        }
        $list = array_values(array_filter(Cache::get("rt:u:{$userId}", []), fn ($s) => $s['id'] > $cursor));

        return [$now, array_map(fn ($s) => ['id' => $s['id'], 'kind' => $s['kind'], 'data' => $s['data']], $list)];
    }
}
