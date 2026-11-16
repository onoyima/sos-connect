/**
 * The SOS alarm sound, made in the browser: an emergency "wail" that sweeps up and down, loud and unmistakable,
 * plus vibration on phones, a flashing tab title and a desktop notification that stays until it is clicked.
 */
let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let osc2: OscillatorNode | null = null;
let gain: GainNode | null = null;
let sweep: number | null = null;
let buzz: number | null = null;
let titleTimer: number | null = null;
let baseTitle = '';
const notes = new Map<number, Notification>();

const audio = () => {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
};

/** True when the browser is blocking sound until the person taps the page (some browsers do on a fresh tab). */
export const soundBlocked = () => !!ctx && ctx.state !== 'running';
export const unlockSound = () => { try { audio(); } catch { /* no audio */ } };

export function startSiren() {
    if (osc) return;
    try {
        const a = audio();
        gain = a.createGain();
        gain.gain.value = 0.0001;
        gain.gain.exponentialRampToValueAtTime(0.32, a.currentTime + 0.15);
        gain.connect(a.destination);
        osc = a.createOscillator();
        osc.type = 'sawtooth';
        osc2 = a.createOscillator(); // a second voice a little apart makes it sound like a real siren
        osc2.type = 'square';
        const g2 = a.createGain();
        g2.gain.value = 0.25;
        osc.connect(gain);
        osc2.connect(g2).connect(gain);
        const wail = () => {
            const t = a.currentTime;
            for (const [o, k] of [[osc!, 1], [osc2!, 1.5]] as const) {
                o.frequency.cancelScheduledValues(t);
                o.frequency.setValueAtTime(620 * k, t);
                o.frequency.linearRampToValueAtTime(1450 * k, t + 1.1);
                o.frequency.linearRampToValueAtTime(620 * k, t + 2.2);
            }
        };
        wail();
        osc.start();
        osc2.start();
        sweep = window.setInterval(wail, 2200);
    } catch { /* no audio device: the screen still shows the alarm */ }
    const vibrate = () => navigator.vibrate?.([900, 300, 900, 300, 900]);
    vibrate();
    buzz = window.setInterval(vibrate, 3600);
}

export function stopSiren() {
    if (sweep) window.clearInterval(sweep);
    if (buzz) window.clearInterval(buzz);
    sweep = buzz = null;
    navigator.vibrate?.(0);
    try {
        if (gain && ctx) gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        const o1 = osc, o2 = osc2;
        window.setTimeout(() => { try { o1?.stop(); o2?.stop(); } catch { /* stopped */ } }, 150);
    } catch { /* ignore */ }
    osc = osc2 = null;
    gain = null;
}

export function flashTitle(text: string) {
    stopTitle();
    baseTitle = document.title;
    let on = false;
    titleTimer = window.setInterval(() => { on = !on; document.title = on ? text : baseTitle; }, 700);
}
export function stopTitle() {
    if (titleTimer) { window.clearInterval(titleTimer); titleTimer = null; document.title = baseTitle || document.title; }
}

/** A desktop notification that stays until clicked (shown even when this tab is in the background). */
export function notifySos(id: number, title: string, body: string, onClick: () => void) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || notes.has(id)) return;
    try {
        const n = new Notification(title, { body, tag: `sos-${id}`, requireInteraction: true });
        n.onclick = () => { window.focus(); onClick(); n.close(); };
        notes.set(id, n);
    } catch { /* some browsers only allow notifications from a service worker */ }
}
export function closeSosNote(id: number) {
    notes.get(id)?.close();
    notes.delete(id);
}
export function askForSosAlerts() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
