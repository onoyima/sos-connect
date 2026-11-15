<?php

namespace App\Support;

use App\Models\Institution;

/**
 * Holds the institution of the signed-in user for this request. Models using BelongsToInstitution
 * are filtered by it automatically, so one institution can never read another's rows by accident.
 */
final class CurrentInstitution
{
    private static ?int $id = null;

    private static bool $bypass = false;

    public static function set(?int $institutionId): void
    {
        self::$id = $institutionId;
    }

    public static function id(): ?int
    {
        return self::$id;
    }

    public static function model(): ?Institution
    {
        return self::$id ? Institution::find(self::$id) : null;
    }

    /** Run code that must see every institution (scheduled jobs, platform admin, gateway ingest). */
    public static function bypass(callable $fn): mixed
    {
        $previous = self::$bypass;
        self::$bypass = true;
        try {
            return $fn();
        } finally {
            self::$bypass = $previous;
        }
    }

    public static function bypassing(): bool
    {
        return self::$bypass;
    }

    /** Run code as if a given institution were signed in (used when ingesting gateway envelopes). */
    public static function as(int $institutionId, callable $fn): mixed
    {
        $previous = self::$id;
        self::$id = $institutionId;
        try {
            return $fn();
        } finally {
            self::$id = $previous;
        }
    }
}
