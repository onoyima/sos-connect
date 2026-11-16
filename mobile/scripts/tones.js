// Plain JavaScript (not TypeScript): app.config.ts loads it while Expo reads the app's settings.
const { existsSync, mkdirSync, statSync, writeFileSync } = require('node:fs');
const { tones: TONES, rings: RINGS } = require('../src/sound/tones.json');

/**
 * Writes the chosen-tone sound files (assets/sounds/tone_*.wav and ring_*.wav; Android only allows letters, digits and _ in sound names) at build time from src/sound/toneDefs.ts,
 * so they are always intact. Each becomes an Android notification channel sound ("tone-chime", "ring-classic"…) and
 * is played in the app (ringtones and previews). Runs from app.config.ts.
 */
const RATE = 22050;

function render(def, repeats = 1) {
    const one = [];
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
            one.push((v / Math.max(1, freqs.length * 0.8)) * env * 0.8);
        }
        for (let i = 0; i < Math.floor(off * RATE); i++) one.push(0);
    }
    const gap = def.period ? Math.max(0, Math.floor(def.period * RATE) - one.length) : 0;
    const samples = [];
    for (let r = 0; r < repeats; r++) { samples.push(...one); if (r < repeats - 1) for (let i = 0; i < gap; i++) samples.push(0); }
    const buf = Buffer.alloc(44 + samples.length * 2);
    buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'ascii'); buf.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
    return buf;
}

/** The sound files the notification plugin bundles. */
function toneFiles() {
    return [...Object.keys(TONES).map((id) => `./assets/sounds/tone_${id}.wav`), ...Object.keys(RINGS).map((id) => `./assets/sounds/ring_${id}.wav`)];
}

function ensureTones() {
    mkdirSync('./assets/sounds', { recursive: true });
    const write = (path, buf) => { if (!existsSync(path) || statSync(path).size !== buf.length) writeFileSync(path, buf); };
    for (const [id, def] of Object.entries(TONES)) write(`./assets/sounds/tone_${id}.wav`, render(def));
    // A ringtone file holds 4 rings (about 10 seconds): the notification plays it once; in the app it loops.
    for (const [id, def] of Object.entries(RINGS)) write(`./assets/sounds/ring_${id}.wav`, render(def, 4));
}

module.exports = { ensureTones, toneFiles };
