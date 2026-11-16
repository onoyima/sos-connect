<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** Call setup messages kept in the database until the other side collects them (see CallController::poll). */
final class CallSignals
{
    public static function put(string $uuid, int $to, array $data): int
    {
        return (int) DB::table('call_signals')->insertGetId([
            'call_uuid' => $uuid, 'to_user_id' => $to, 'data' => Sealed::seal(json_encode($data)), 'created_at' => now(),
        ]);
    }

    /** @return array<int, array{id:int, data:array}> */
    public static function since(string $uuid, int $me, int $after): array
    {
        return DB::table('call_signals')->where('call_uuid', $uuid)->where('to_user_id', $me)->where('id', '>', $after)
            ->orderBy('id')->limit(200)->get(['id', 'data'])
            ->map(fn ($s) => ['id' => (int) $s->id, 'data' => json_decode((string) Sealed::open($s->data), true) ?: []])->all();
    }

    public static function forget(string $uuid): void
    {
        DB::table('call_signals')->where('call_uuid', $uuid)->delete();
    }

    /** Leftovers from calls that never ended properly. */
    public static function prune(): void
    {
        $old = DB::table('call_signals')->where('created_at', '<', now()->subDay())->limit(1000)->pluck('id');
        if ($old->isNotEmpty()) {
            DB::table('call_signals')->whereIn('id', $old)->delete();
        }
    }
}
