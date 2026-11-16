import { RINGS, TONES, type ToneDef } from './toneDefs';
import type { SoundChoices } from '@/types';

/** Plays the tones people choose (Settings > Sounds) in the browser. */
let ctx: AudioContext | null = null;
let ringTimer: number | null = null;
let current: SoundChoices | null = null;

const audio = () => {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
};

/** The signed-in person's choices (set from the page data, updated when they change them). */
export const setSoundChoices = (s: SoundChoices | null | undefined) => { current = s ?? null; };
export const soundChoices = () => current;

function play(def: ToneDef, volume = 0.25) {
    const a = audio();
    let t = a.currentTime + 0.02;
    for (const [freqs, on, off] of def.notes) {
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(volume, t + 0.012);
        if (def.decay) g.gain.exponentialRampToValueAtTime(0.0001, t + on);
        else { g.gain.setValueAtTime(volume, t + on - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + on); }
        g.connect(a.destination);
        freqs.forEach((f, i) => {
            const o = a.createOscillator();
            o.type = def.wave;
            o.frequency.value = f;
            const h = a.createGain();
            h.gain.value = i === 0 ? 1 : 0.35 / i; // overtones quieter
            o.connect(h).connect(g);
            o.start(t);
            o.stop(t + on + 0.02);
        });
        t += on + off;
    }
}

/** A short alert tone by name ("silent" plays nothing). */
export function playTone(id: string | undefined, volume?: number) {
    const def = id ? TONES[id] : undefined;
    if (!def) return;
    try { play(def, volume); } catch { /* no audio device */ }
}

/** The chosen tone for a kind of alert: message, group, request, notice. */
export function playFor(kind: 'message' | 'group' | 'request' | 'notice') {
    playTone(current?.[kind] ?? { message: 'chime', group: 'pop', request: 'note', notice: 'bell' }[kind]);
}

/** A ringtone on repeat until stopRingtone(). Returns false for "silent". */
export function startRingtone(id: string | undefined): boolean {
    stopRingtone();
    const def = id ? RINGS[id] : undefined;
    if (!def) return false;
    try {
        play(def, 0.3);
        ringTimer = window.setInterval(() => play(def, 0.3), (def.period ?? 3) * 1000);
    } catch { return false; }
    return true;
}
export function stopRingtone() {
    if (ringTimer) window.clearInterval(ringTimer);
    ringTimer = null;
}

/** One play of a ringtone, for the preview button. */
export function previewRing(id: string) {
    const def = RINGS[id];
    if (def) try { play(def, 0.3); } catch { /* no audio */ }
}
