import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/** The tone files made at build time (scripts/tones.ts). Static requires so the bundler includes them. */
const FILES: Record<string, number> = {
    'tone-chime': require('../../assets/sounds/tone_chime.wav'),
    'tone-ding': require('../../assets/sounds/tone_ding.wav'),
    'tone-pop': require('../../assets/sounds/tone_pop.wav'),
    'tone-bell': require('../../assets/sounds/tone_bell.wav'),
    'tone-marimba': require('../../assets/sounds/tone_marimba.wav'),
    'tone-note': require('../../assets/sounds/tone_note.wav'),
    'tone-drop': require('../../assets/sounds/tone_drop.wav'),
    'ring-classic': require('../../assets/sounds/ring_classic.wav'),
    'ring-digital': require('../../assets/sounds/ring_digital.wav'),
    'ring-marimba': require('../../assets/sounds/ring_marimba.wav'),
    'ring-soft': require('../../assets/sounds/ring_soft.wav'),
    'ring-pulse': require('../../assets/sounds/ring_pulse.wav'),
};

let preview: AudioPlayer | null = null;

/** Plays a tone once (Settings > Sounds previews). */
export async function playOnce(set: 'tone' | 'ring', id: string) {
    const file = FILES[`${set}-${id}`];
    if (!file) return;
    try {
        try { preview?.pause(); preview?.remove(); } catch { /* gone */ }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        preview = createAudioPlayer(file);
        preview.play();
    } catch { /* no sound */ }
}

/** The file for a chosen ringtone, to loop while a call rings (null = silent or unknown). */
export const ringFile = (id: string | undefined): number | null => (id && FILES[`ring-${id}`]) || null;
