/**
 * The tones people choose from (Settings > Sounds). Each is a few notes: [frequencies in Hz, seconds on, seconds of
 * silence after]. "decay" fades each note like a struck bell or marimba. Rings repeat every `period` seconds.
 * The same definitions are in mobile/src/sound/toneDefs.ts (keep both the same) and app/Support/Sounds.php (names).
 */
export type Note = [number[], number, number];
export type ToneDef = { notes: Note[]; wave: OscillatorType; decay?: boolean; period?: number };

export const TONES: Record<string, ToneDef> = {
    chime: { wave: 'sine', decay: true, notes: [[[880], 0.12, 0.03], [[1318], 0.32, 0]] },
    ding: { wave: 'sine', decay: true, notes: [[[1046, 2093], 0.5, 0]] },
    pop: { wave: 'triangle', notes: [[[700], 0.05, 0.02], [[1050], 0.08, 0]] },
    bell: { wave: 'sine', decay: true, notes: [[[784, 1568, 2352], 0.8, 0]] },
    marimba: { wave: 'triangle', decay: true, notes: [[[523], 0.12, 0.02], [[659], 0.12, 0.02], [[784], 0.25, 0]] },
    note: { wave: 'sine', notes: [[[587], 0.1, 0.03], [[880], 0.1, 0.03], [[1175], 0.25, 0]] },
    drop: { wave: 'sine', decay: true, notes: [[[1200], 0.06, 0], [[800], 0.16, 0]] },
};

export const RINGS: Record<string, ToneDef> = {
    classic: { wave: 'sine', period: 3, notes: [[[440, 480], 0.4, 0.2], [[440, 480], 0.4, 0]] },
    digital: { wave: 'square', period: 2.5, notes: [[[1000], 0.07, 0.04], [[1000], 0.07, 0.04], [[1000], 0.07, 0.04], [[800], 0.07, 0.04], [[800], 0.07, 0.04], [[800], 0.07, 0]] },
    marimba: { wave: 'triangle', decay: true, period: 2.4, notes: [[[523], 0.15, 0.05], [[659], 0.15, 0.05], [[784], 0.15, 0.05], [[1046], 0.35, 0]] },
    soft: { wave: 'sine', period: 3.2, notes: [[[392], 0.45, 0.1], [[523], 0.7, 0]] },
    pulse: { wave: 'triangle', period: 2.2, notes: [[[660], 0.15, 0.1], [[660], 0.15, 0.1], [[880], 0.25, 0]] },
};

/**
 * What the caller hears. "calling": the call is going out but hasn't reached the other person's phone or browser
 * yet (they may be offline). "ringback": it's ringing on their side now, waiting for them to answer.
 */
export const CALL_TONES: Record<'calling' | 'ringback', ToneDef> = {
    calling: { wave: 'sine', period: 2, notes: [[[480], 0.12, 0.12], [[480], 0.12, 0]] },
    ringback: { wave: 'sine', period: 4, notes: [[[425], 1.2, 0]] },
};
