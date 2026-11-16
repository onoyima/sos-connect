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

        // Each person hears the tone they chose (Settings > Sounds); on Android each tone has its own channel.
        $kind = match ($data['type'] ?? null) {
            'message' => ! empty($data['group']) ? 'group' : 'message',
            'call' => 'call', 'group_call' => 'group_call', 'chat_request' => 'request',
            'announcement', 'safety_check' => 'notice',
            default => null,
        };
        $devices = CurrentInstitution::bypass(fn () => Device::query()
            ->whereIn('user_id', $userIds)
            ->whereNull('revoked_at')
            ->whereNotNull('push_token')
            ->get(['user_id', 'push_token']));
        $prefs = $kind && ! $urgent ? \App\Models\User::whereIn('id', $devices->pluck('user_id')->unique())->get(['id', 'preferences'])->keyBy('id') : collect();
        $groups = [];
        foreach ($devices->unique('push_token') as $d) {
            $tone = $kind && ! $urgent ? (\App\Support\Sounds::for($prefs[$d->user_id] ?? null)[$kind] ?? null) : null;
            $groups[$tone ?? ''][] = $d->push_token;
        }

        foreach ($groups as $tone => $tokens) {
            $this->send($tokens, $title, $body, $data, $urgent, $tone !== '' ? (string) $tone : null, $kind);
        }
    }

    private function send(array $tokens, string $title, string $body, array $data, bool $urgent, ?string $tone, ?string $kind): void
    {
        $ring = in_array($kind, ['call', 'group_call'], true);
        foreach (array_chunk($tokens, 100) as $chunk) {
            $messages = array_map(fn ($t) => [
                'to' => $t,
                'title' => $title,
                'body' => mb_substr($body, 0, 140),
                'data' => $data,
                // SOS: the siren, on the phone's alarm channel (rings through Do Not Disturb on Android).
                // Otherwise the person's chosen tone, on that tone's channel ("silent" = no sound).
                'sound' => $urgent ? 'siren.wav' : ($tone === 'silent' ? null : ($tone ? ($ring ? "ring_{$tone}.wav" : "tone_{$tone}.wav") : 'default')),
                'priority' => 'high',
                'channelId' => $urgent ? 'sos-siren' : ($tone ? ($ring ? "ring-{$tone}" : "tone-{$tone}") : 'messages'),
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
