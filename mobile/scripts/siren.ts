import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Writes the SOS alarm sound (assets/sounds/siren.wav) at build time, so it is always exactly right however the code
 * is copied: an emergency "wail" sweeping 620 Hz → 1450 Hz → 620 Hz every 2 seconds, 6 seconds long, 22 kHz mono.
 * Used by the 'sos-siren' notification channel and the in-app alarm. Runs from app.config.ts.
 */
const RATE = 22050;
const SECONDS = 6;
const SAMPLES = RATE * SECONDS;
export const SIREN_BYTES = 44 + SAMPLES * 2;

export function ensureSiren(path = './assets/sounds/siren.wav'): void {
    if (existsSync(path) && statSync(path).size === SIREN_BYTES) return;
    const buf = Buffer.alloc(SIREN_BYTES);
    buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + SAMPLES * 2, 4); buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'ascii'); buf.writeUInt32LE(SAMPLES * 2, 40);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < SAMPLES; i++) {
        const t = i / RATE;
        const c = (t % 2) / 2;
        const f = 620 + (1450 - 620) * (1 - Math.abs(2 * c - 1));
        p1 += (2 * Math.PI * f) / RATE;
        p2 += (2 * Math.PI * f * 1.5) / RATE;
        const saw = 2 * ((p1 / (2 * Math.PI)) % 1) - 1;
        const sq = Math.sin(p2) >= 0 ? 1 : -1;
        const fade = Math.min(1, i / (RATE * 0.05), (SAMPLES - i) / (RATE * 0.08));
        const v = Math.max(-1, Math.min(1, (0.72 * saw + 0.18 * sq) * 0.85 * fade));
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
}
