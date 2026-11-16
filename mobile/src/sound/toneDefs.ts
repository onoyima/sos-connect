import data from './tones.json';

/**
 * The tones people choose from (Settings > Sounds), kept in tones.json so the build script (scripts/tones.js) reads
 * the same list. Each is a few notes: [frequencies in Hz, seconds on, seconds of silence after]. "decay" fades each
 * note like a struck bell or marimba. Rings repeat every `period` seconds.
 * The same definitions are in resources/js/lib/toneDefs.ts (keep both the same) and app/Support/Sounds.php (names).
 */
export type Note = [number[], number, number];
export type ToneDef = { notes: Note[]; wave: 'sine' | 'triangle' | 'square'; decay?: boolean; period?: number };

export const TONES = data.tones as unknown as Record<string, ToneDef>;
export const RINGS = data.rings as unknown as Record<string, ToneDef>;
