import { playTone, soundChoices, startCallTone, startRingtone, stopRingtone } from './tones';
/**
 * Call sounds (played as sound files, see tones.ts): the chosen ringtone for incoming calls, and for the caller a
 * "calling" tone until it reaches the other side, then ringback while it rings there. Also flashes the tab title and, if the page is in the background, shows a desktop
 * notification, so nobody misses a call.
 */
let titleTimer: number | null = null;
let baseTitle = '';
let note: Notification | null = null;

/**
 * incoming: the person's chosen ringtone (Settings > Sounds; "silent" only flashes and vibrates).
 * calling: the call hasn't reached the other side yet. ringback: it's ringing there, waiting for an answer.
 */
export function startRing(kind: 'incoming' | 'calling' | 'ringback', who?: string, onClickNotice?: () => void, ringtone?: 'call' | 'group_call') {
    stopRing();
    if (kind === 'incoming') {
        const chosen = soundChoices()?.[ringtone ?? 'call'] ?? (ringtone === 'group_call' ? 'marimba' : 'classic');
        if (chosen !== 'silent') startRingtone(chosen);
    } else {
        startCallTone(kind);
    }

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
    stopRingtone();
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
    playTone('marimba');
}
