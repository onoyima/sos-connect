/**
 * Call sounds made in the browser (no audio files): a ringtone for incoming calls and a ringback tone while
 * calling someone. Also flashes the tab title and, if the page is in the background, shows a desktop
 * notification, so nobody misses a call.
 */
let ctx: AudioContext | null = null;
let loop: number | null = null;
let titleTimer: number | null = null;
let baseTitle = '';
let note: Notification | null = null;

const audio = () => {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
};

/** One burst of two tones mixed together, faded in and out so it doesn't click. */
function burst(freqs: number[], seconds: number, volume: number) {
    const a = audio();
    const gain = a.createGain();
    gain.gain.setValueAtTime(0, a.currentTime);
    gain.gain.linearRampToValueAtTime(volume, a.currentTime + 0.03);
    gain.gain.setValueAtTime(volume, a.currentTime + seconds - 0.05);
    gain.gain.linearRampToValueAtTime(0, a.currentTime + seconds);
    gain.connect(a.destination);
    for (const f of freqs) {
        const o = a.createOscillator();
        o.frequency.value = f;
        o.connect(gain);
        o.start();
        o.stop(a.currentTime + seconds);
    }
}

export function startRing(kind: 'incoming' | 'outgoing', who?: string, onClickNotice?: () => void) {
    stopRing();
    try {
        const play = kind === 'incoming'
            ? () => { burst([440, 480], 0.4, 0.22); window.setTimeout(() => burst([440, 480], 0.4, 0.22), 600); }
            : () => burst([425], 1, 0.08);
        play();
        loop = window.setInterval(play, kind === 'incoming' ? 2600 : 4000);
    } catch { /* no audio device: the screen still shows the call */ }

    if (kind === 'incoming') {
        navigator.vibrate?.([600, 400, 600, 400, 600]);
        baseTitle = document.title;
        let on = false;
        titleTimer = window.setInterval(() => { on = !on; document.title = on ? `📞 ${who ?? 'Someone'} is calling…` : baseTitle; }, 900);
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try {
                note = new Notification(`${who ?? 'Someone'} is calling`, { body: 'Tap to answer in SOS Connect.', tag: 'sos-call', requireInteraction: true });
                note.onclick = () => { window.focus(); onClickNotice?.(); note?.close(); };
            } catch { /* some browsers only allow notifications from a service worker */ }
        }
    }
}

export function stopRing() {
    if (loop) window.clearInterval(loop);
    loop = null;
    if (titleTimer) { window.clearInterval(titleTimer); titleTimer = null; document.title = baseTitle || document.title; }
    navigator.vibrate?.(0);
    note?.close();
    note = null;
}

/** Asks once for permission to show call alerts when the page is in the background. */
export function askForCallAlerts() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

/** Short "ding" for a group call starting. */
export function ding() {
    try { burst([660], 0.15, 0.15); window.setTimeout(() => burst([880], 0.2, 0.15), 180); } catch { /* ignore */ }
}
