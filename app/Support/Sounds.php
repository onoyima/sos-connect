<?php

namespace App\Support;

use App\Models\User;

/**
 * The tones people can choose (Settings > Sounds), one per kind of alert. The same tones are made in the browser
 * (resources/js/lib/tones.ts) and generated as sound files for the phone app (mobile/scripts/tones.ts), where each
 * tone has its own notification channel ("tone-<id>"). SOS always uses the siren and can't be changed.
 */
final class Sounds
{
    /** Short alert tones (messages, requests, notices). */
    public const TONES = ['chime' => 'Chime', 'ding' => 'Ding', 'pop' => 'Pop', 'bell' => 'Bell', 'marimba' => 'Marimba', 'note' => 'Note', 'drop' => 'Drop', 'silent' => 'Silent'];

    /** Ringtones (calls), played on repeat while ringing. */
    public const RINGS = ['classic' => 'Classic', 'digital' => 'Digital', 'marimba' => 'Marimba', 'soft' => 'Soft', 'pulse' => 'Pulse', 'silent' => 'Silent (vibrate only)'];

    public const KINDS = [
        'message' => ['label' => 'Messages', 'set' => 'tones', 'default' => 'chime'],
        'group' => ['label' => 'Group messages', 'set' => 'tones', 'default' => 'pop'],
        'call' => ['label' => 'Calls', 'set' => 'rings', 'default' => 'classic'],
        'group_call' => ['label' => 'Group calls', 'set' => 'rings', 'default' => 'marimba'],
        'request' => ['label' => 'Chat requests', 'set' => 'tones', 'default' => 'note'],
        'notice' => ['label' => 'Notices', 'set' => 'tones', 'default' => 'bell'],
    ];

    /** This person's choices, with defaults for anything not chosen. */
    public static function for(?User $user): array
    {
        $saved = (array) (($user?->preferences ?? [])['sounds'] ?? []);
        $out = [];
        foreach (self::KINDS as $k => $def) {
            $list = $def['set'] === 'rings' ? self::RINGS : self::TONES;
            $out[$k] = isset($saved[$k]) && isset($list[$saved[$k]]) ? $saved[$k] : $def['default'];
        }

        return $out;
    }

    public static function catalog(): array
    {
        return ['kinds' => self::KINDS, 'tones' => self::TONES, 'rings' => self::RINGS];
    }
}
