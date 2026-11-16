<?php

namespace App\Support;

/** Phone numbers in the international form WhatsApp links need (digits only, country code first). */
final class PhoneNumber
{
    private const CODES = ['NG' => '234', 'GH' => '233', 'KE' => '254', 'ZA' => '27', 'UG' => '256', 'TZ' => '255', 'RW' => '250', 'CM' => '237', 'SN' => '221', 'CI' => '225', 'GB' => '44', 'US' => '1'];

    public static function international(?string $raw, ?string $country = 'NG'): ?string
    {
        $raw = trim((string) $raw);
        if ($raw === '') {
            return null;
        }
        $plus = str_starts_with($raw, '+') || str_starts_with($raw, '00');
        $d = preg_replace('/\D+/', '', $raw);
        if (str_starts_with($raw, '00')) {
            $d = substr($d, 2);
        }
        $code = self::CODES[strtoupper((string) $country)] ?? '234';
        if (! $plus) {
            if (str_starts_with($d, '0')) {
                $d = $code.substr($d, 1);          // 0803… → 234803…
            } elseif (! str_starts_with($d, $code) && strlen($d) <= 10) {
                $d = $code.$d;                     // 803… → 234803…
            }
        }

        return strlen($d) >= 8 && strlen($d) <= 15 ? $d : null;
    }

    /** "+234 803 000 0000" style for showing. */
    public static function pretty(?string $international): ?string
    {
        if (! $international) {
            return null;
        }
        foreach (self::CODES as $code) {
            if (str_starts_with($international, $code)) {
                $rest = substr($international, strlen($code));
                $parts = strlen($rest) === 10 ? [substr($rest, 0, 3), substr($rest, 3, 3), substr($rest, 6)] : str_split($rest, 3);

                return '+'.$code.' '.implode(' ', $parts); // +234 803 000 0000
            }
        }

        return '+'.$international;
    }
}
