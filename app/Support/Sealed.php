<?php

namespace App\Support;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;

/**
 * Encryption for personal data kept in the database (AES-256 with the app key, the same as Laravel's "encrypted"
 * casts), for tables read without models. A database dump or backup alone shows none of it.
 */
final class Sealed
{
    public static function seal(?string $plain): ?string
    {
        return $plain === null ? null : Crypt::encryptString($plain);
    }

    /** Plain text from a sealed value; values written before encryption was added come back as they are. */
    public static function open(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        try {
            return Crypt::decryptString($value);
        } catch (DecryptException) {
            return $value;
        }
    }

    public static function isSealed(?string $value): bool
    {
        if ($value === null || $value === '') {
            return true;
        }
        try {
            Crypt::decryptString($value);

            return true;
        } catch (DecryptException) {
            return false;
        }
    }

    /**
     * A one-way fingerprint of a phone number (keyed with the app key), so a person can still be found by
     * their number without the number itself being stored readable.
     */
    public static function phoneIndex(?string $phone): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $phone);
        if (strlen($digits) < 7) {
            return null;
        }
        $digits = substr($digits, -10); // 0803 123 4567 and +234 803 123 4567 match

        return hash_hmac('sha256', $digits, (string) config('app.key'));
    }
}
