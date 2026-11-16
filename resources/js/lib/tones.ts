import { CALL_TONES, RINGS, TONES, type ToneDef } from './toneDefs';
import type { SoundChoices } from '@/types';

/**
 * Plays the tones people choose (Settings > Sounds) in the browser.
 *
 * The tones are made into small sound files here (the same way the phone app makes its own), then played through
 * an ordinary audio player. Phones handle that more reliably than generated Web Audio, which iPhones mute
 * whenever the ring/silent switch is on and some Android browsers keep paused. The players are unlocked by the
 * first tap or key press on the page, so later alerts (a message arriving) can sound without one.
 */
const RATE = 22050;
const files = new Map<string, string>(); // "tone-chime" -> blob: URL
let current: SoundChoices | null = null;
let alertPlayer: HTMLAudioElement | null = null;
let ringPlayer: HTMLAudioElement | null = null;

function render(def: ToneDef, volume: number, ring: boolean): Float32Array {
    const out: number[] = [];
    for (const [freqs, on, off] of def.notes) {
        const n = Math.floor(on * RATE);
        for (let i = 0; i < n; i++) {
            const t = i / RATE;
            const env = def.decay ? Math.exp((-4.5 * i) / n) : Math.min(1, i / (RATE * 0.012), (n - i) / (RATE * 0.03));
            let v = 0;
            freqs.forEach((f, k) => {
                const ph = (f * t) % 1;
                const w = def.wave === 'square' ? (ph < 0.5 ? 1 : -1) : def.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * f * t);
                v += w * (k === 0 ? 1 : 0.35 / k);
            });
            out.push((v / Math.max(1, freqs.length * 0.8)) * env * volume);
        }
        for (let i = 0; i < Math.floor(off * RATE); i++) out.push(0);
    }
    // A ringtone file is one ring plus the pause before the next, so looping it rings at the right pace.
    if (ring && def.period) while (out.length < def.period * RATE) out.push(0);
    return Float32Array.from(out);
}

function wav(samples: Float32Array): Blob {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
    v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
    return new Blob([buf], { type: 'audio/wav' });
}

function fileFor(set: 'tone' | 'ring' | 'call', id: string): string | null {
    const key = `${set}-${id}`;
    if (!files.has(key)) {
        const def = set === 'ring' ? RINGS[id] : set === 'call' ? CALL_TONES[id as 'calling'] : TONES[id];
        if (!def) return null;
        files.set(key, URL.createObjectURL(wav(render(def, set === 'tone' ? 0.7 : set === 'call' ? 0.45 : 0.75, set !== 'tone'))));
    }
    return files.get(key)!;
}

const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';
const player = (which: 'alert' | 'ring') => {
    if (which === 'alert') return (alertPlayer ??= Object.assign(new Audio(), { preload: 'auto' }));
    return (ringPlayer ??= Object.assign(new Audio(), { preload: 'auto', loop: true }));
};

// The first tap or key press on the page unlocks both players (browsers only allow sound after one).
if (typeof window !== 'undefined') {
    const unlock = () => {
        for (const p of [player('alert'), player('ring')]) {
            if (p.src) continue;
            p.src = SILENT;
            p.play().catch(() => {});
        }
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
}

function sound(which: 'alert' | 'ring', url: string) {
    const p = player(which);
    try {
        p.pause();
        p.src = url;
        p.currentTime = 0;
        p.play().catch((e) => console.warn('[SOS Connect] The browser did not allow a sound yet (tap the page once).', e?.name));
    } catch { /* no audio device */ }
}

/** The signed-in person's choices (set from the page data, updated when they change them). */
export const setSoundChoices = (s: SoundChoices | null | undefined) => { current = s ?? null; };
export const soundChoices = () => current;

/** A short alert tone by name ("silent" plays nothing). */
export function playTone(id: string | undefined, _volume?: number) {
    const url = id ? fileFor('tone', id) : null;
    if (url) sound('alert', url);
}

/** The chosen tone for a kind of alert: message, group, request, notice. */
export function playFor(kind: 'message' | 'group' | 'request' | 'notice') {
    playTone(current?.[kind] ?? { message: 'chime', group: 'pop', request: 'note', notice: 'bell' }[kind]);
}

/** A ringtone on repeat until stopRingtone(). Returns false for "silent". */
export function startRingtone(id: string | undefined): boolean {
    stopRingtone();
    const url = id ? fileFor('ring', id) : null;
    if (!url) return false;
    sound('ring', url);
    return true;
}
/** The caller's tone, on repeat until stopRingtone(): "calling" (not reached them yet) or "ringback" (ringing there). */
export function startCallTone(kind: 'calling' | 'ringback') {
    const url = fileFor('call', kind);
    if (url) sound('ring', url);
}
export function stopRingtone() {
    if (ringPlayer) { ringPlayer.pause(); ringPlayer.currentTime = 0; }
}

/** One play of a ringtone, for the preview button (not looped). */
export function previewRing(id: string) {
    const url = fileFor('ring', id);
    if (url) sound('alert', url);
}
