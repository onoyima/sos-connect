<?php

namespace App\Support;

use App\Models\Institution;
use Carbon\CarbonImmutable;

/**
 * The institution's look: favicon and chat icon (uploaded by an admin, or the built-in mark), and a seasonal touch
 * added automatically around celebrations: a small badge on the icon and the favicon. Dates are worked out each
 * year (Easter by the Gregorian computus, Eid by the tabular Islamic calendar, ±1 day), so nothing needs updating.
 */
final class Branding
{
    /** Season key => label, badge (emoji) and accent colour. */
    public const SEASONS = [
        'christmas' => ['label' => 'Christmas', 'badge' => '🎄', 'accent' => '#c62828'],
        'new_year' => ['label' => 'New Year', 'badge' => '🎆', 'accent' => '#6a1b9a'],
        'easter' => ['label' => 'Easter', 'badge' => '🐣', 'accent' => '#7b5ea7'],
        'eid_fitr' => ['label' => 'Eid al-Fitr', 'badge' => '🌙', 'accent' => '#00796b'],
        'eid_adha' => ['label' => 'Eid al-Adha', 'badge' => '🌙', 'accent' => '#00796b'],
        'independence' => ['label' => 'Independence Day', 'badge' => '🎉', 'accent' => '#008751'],
        'valentine' => ['label' => "Valentine's Day", 'badge' => '💚', 'accent' => '#d81b60'],
    ];

    /** Independence days by country (month, day) and the flag used as the badge. */
    private const INDEPENDENCE = [
        'NG' => [10, 1, '🇳🇬'], 'GH' => [3, 6, '🇬🇭'], 'KE' => [12, 12, '🇰🇪'], 'ZA' => [4, 27, '🇿🇦'], 'UG' => [10, 9, '🇺🇬'],
        'TZ' => [12, 9, '🇹🇿'], 'CM' => [5, 20, '🇨🇲'], 'SN' => [4, 4, '🇸🇳'], 'RW' => [7, 1, '🇷🇼'], 'ZM' => [10, 24, '🇿🇲'],
        'SL' => [4, 27, '🇸🇱'], 'LR' => [7, 26, '🇱🇷'], 'GM' => [2, 18, '🇬🇲'], 'BW' => [9, 30, '🇧🇼'], 'ET' => [5, 28, '🇪🇹'],
    ];

    public static function settings(?Institution $i): array
    {
        $b = ($i?->settings ?? [])['branding'] ?? [];

        return [
            'favicon' => $b['favicon'] ?? null,
            'icon' => $b['icon'] ?? null,
            'seasonal' => (bool) ($b['seasonal'] ?? true),
            'seasons' => $b['seasons'] ?? array_keys(self::SEASONS),
            'version' => (string) ($b['version'] ?? '0'),
        ];
    }

    /** What pages and the phone app need: icon addresses and today's season (if any, and switched on). */
    public static function forClient(?Institution $i, ?CarbonImmutable $today = null): array
    {
        $s = self::settings($i);
        $season = $s['seasonal'] ? self::seasonOn($today ?? CarbonImmutable::now(), $i?->country ?? 'NG') : null;
        if ($season && ! in_array($season['key'], $s['seasons'], true)) {
            $season = null;
        }

        return [
            'favicon' => $i && $s['favicon'] ? url("/brand/{$i->id}/favicon?v={$s['version']}") : null,
            'icon' => $i && $s['icon'] ? url("/brand/{$i->id}/icon?v={$s['version']}") : null,
            'season' => $season,
        ];
    }

    /** The celebration happening on this day (the window around each one), or null. */
    public static function seasonOn(CarbonImmutable $d, string $country = 'NG'): ?array
    {
        $y = $d->year;
        $in = fn (CarbonImmutable $from, CarbonImmutable $to) => $d->betweenIncluded($from->startOfDay(), $to->endOfDay());
        $pick = function (string $key, array $extra = []) {
            return ['key' => $key] + self::SEASONS[$key] + $extra;
        };

        if ($in(CarbonImmutable::create($y, 12, 31), CarbonImmutable::create($y, 12, 31)) || $in(CarbonImmutable::create($y, 1, 1), CarbonImmutable::create($y, 1, 2))) {
            return $pick('new_year');
        }
        if ($in(CarbonImmutable::create($y, 12, 15), CarbonImmutable::create($y, 12, 30))) {
            return $pick('christmas');
        }
        $easter = self::easter($y);
        if ($in($easter->subDays(2), $easter->addDay())) { // Good Friday to Easter Monday
            return $pick('easter');
        }
        foreach ([[10, 1, 'eid_fitr'], [12, 10, 'eid_adha']] as [$hm, $hd, $key]) {
            foreach ([$y - 1, $y, $y + 1] as $gy) {
                $day = self::hijriToGregorian(self::gregorianToHijriYear($gy), $hm, $hd);
                if ($in($day->subDay(), $day->addDays(2))) {
                    return $pick($key);
                }
            }
        }
        $country = strtoupper($country);
        if (isset(self::INDEPENDENCE[$country])) {
            [$m, $dd, $flag] = self::INDEPENDENCE[$country];
            if ($in(CarbonImmutable::create($y, $m, $dd)->subDay(), CarbonImmutable::create($y, $m, $dd))) {
                return $pick('independence', ['badge' => $flag]);
            }
        }
        if ($d->month === 2 && $d->day === 14) {
            return $pick('valentine');
        }

        return null;
    }

    /** Easter Sunday (anonymous Gregorian algorithm). */
    public static function easter(int $y): CarbonImmutable
    {
        $a = $y % 19; $b = intdiv($y, 100); $c = $y % 100; $d = intdiv($b, 4); $e = $b % 4;
        $f = intdiv($b + 8, 25); $g = intdiv($b - $f + 1, 3); $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4); $k = $c % 4; $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7; $m = intdiv($a + 11 * $h + 22 * $l, 451);
        $month = intdiv($h + $l - 7 * $m + 114, 31); $day = (($h + $l - 7 * $m + 114) % 31) + 1;

        return CarbonImmutable::create($y, $month, $day);
    }

    /** Tabular Islamic calendar → Gregorian (civil epoch, accurate to about a day). */
    public static function hijriToGregorian(int $hy, int $hm, int $hd): CarbonImmutable
    {
        $jd = intdiv(11 * $hy + 3, 30) + 354 * $hy + 30 * $hm - intdiv($hm - 1, 2) + $hd + 1948440 - 385;

        return CarbonImmutable::createFromTimestampUTC(($jd - 2440588) * 86400)->startOfDay();
    }

    /** The Islamic year in progress at the start of a Gregorian year (close enough to search around). */
    private static function gregorianToHijriYear(int $gy): int
    {
        return (int) floor(($gy - 622) * 33 / 32);
    }
}
