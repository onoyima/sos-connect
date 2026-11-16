<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** The platform owner's switches (billing and payments), stored in platform_settings and cached. */
final class PlatformSettings
{
    private static ?array $all = null;

    public static function all(): array
    {
        if (self::$all !== null) {
            return self::$all;
        }
        try {
            return self::$all = Cache::remember('platform-settings', 300, fn () => Schema::hasTable('platform_settings')
                ? DB::table('platform_settings')->pluck('value', 'key')->map(fn ($v) => json_decode((string) $v, true))->all()
                : []);
        } catch (\Throwable) {
            return self::$all = [];
        }
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return array_key_exists($key, self::all()) ? self::all()[$key] : $default;
    }

    public static function put(array $values): void
    {
        foreach ($values as $k => $v) {
            DB::table('platform_settings')->updateOrInsert(['key' => $k], ['value' => json_encode($v), 'updated_at' => now(), 'created_at' => now()]);
        }
        self::forget();
    }

    public static function forget(): void
    {
        self::$all = null;
        Cache::forget('platform-settings');
    }
}
