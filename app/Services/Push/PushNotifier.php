<?php

namespace App\Services\Push;

use App\Models\Device;
use App\Support\CurrentInstitution;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Sends Expo push notifications in batches of 100 (one HTTP call per 100 phones, not one per phone).
 * Push content is kept short and never contains message text for SOS alerts beyond the category,
 * because lock screens are visible to anyone nearby.
 */
class PushNotifier
{
    /** @param int[] $userIds */
    public function toUsers(array $userIds, string $title, string $body, array $data = [], bool $urgent = false): void
    {
        if (! $userIds) {
            return;
        }

        $tokens = CurrentInstitution::bypass(fn () => Device::query()
            ->whereIn('user_id', $userIds)
            ->whereNull('revoked_at')
            ->whereNotNull('push_token')
            ->pluck('push_token')->unique()->values()->all());

        foreach (array_chunk($tokens, 100) as $chunk) {
            $messages = array_map(fn ($t) => [
                'to' => $t,
                'title' => $title,
                'body' => mb_substr($body, 0, 140),
                'data' => $data,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => $urgent ? 'sos' : 'messages',
                'ttl' => $urgent ? 3600 : 86400,
            ], $chunk);

            try {
                $res = Http::timeout(10)->acceptJson()->post(config('sos.push.expo_url'), $messages);
                foreach ($res->json('data') ?? [] as $i => $ticket) {
                    if (($ticket['details']['error'] ?? null) === 'DeviceNotRegistered') {
                        CurrentInstitution::bypass(fn () => Device::where('push_token', $chunk[$i])->update(['push_token' => null]));
                    }
                }
            } catch (Throwable $e) {
                report($e);
            }
        }
    }
}
