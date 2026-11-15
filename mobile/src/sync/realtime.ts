import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { AppState } from 'react-native';
import { config } from '@/config';
import { api, getToken } from '@/lib/api';
import { emit } from '@/lib/events';
import { loadIdentity } from '@/mesh/identity';

type Settings = { key: string; host: string | null; port: number; scheme: string };

let echo: Echo<'reverb'> | null = null;
let connected = false;
let onChangeCb: (() => void) | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let cursor = -1;
let stamps: Record<string, string> | null = null;
let fast = false;
let latestBadges = { chats: 0, calls: 0, requests: 0 };
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

export const currentBadges = () => latestBadges;

/** Fetches the red counts soon (several triggers in a row cause one request). */
export function refreshBadges() {
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
        api<{ badges: typeof latestBadges }>('/badges').then((r) => { latestBadges = r.badges; emit('badges', r.badges); }).catch(() => {});
    }, 400);
}
let active = true;
const seen: number[] = [];

/**
 * Live updates while online.
 *  - Websocket (Laravel Reverb) when the server runs it. The connection details come from the server itself, so
 *    the app needs no extra setup; events only say "something changed", then the sync engine fetches the delta.
 *  - When the websocket can't connect, the app asks the server "anything new?" every few seconds instead
 *    (every second during a call), so chats, SOS and calls never wait for a manual refresh.
 */
export async function connectRealtime(onChange: () => void) {
    onChangeCb = onChange;
    startPulse();
    if (echo) return;
    const token = await getToken();
    const id = await loadIdentity();
    if (!token || !id) return;

    const s: Settings | null = config.reverb.key
        ? { key: config.reverb.key, host: config.reverb.host || null, port: config.reverb.port, scheme: config.reverb.scheme }
        : (await api<{ realtime: Settings | null }>('/realtime').catch(() => ({ realtime: null }))).realtime;
    if (!s?.key) return; // live updates are off on the server: the regular check covers it
    const host = s.host || hostOf(config.apiUrl);

    echo = new Echo({
        broadcaster: 'reverb',
        Pusher,
        key: s.key,
        wsHost: host,
        wsPort: s.port,
        wssPort: s.port,
        forceTLS: s.scheme === 'https',
        enabledTransports: ['ws', 'wss'],
        authEndpoint: `${config.apiUrl}/broadcasting/auth`,
        auth: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    } as never);

    const pusher = (echo.connector as any).pusher;
    pusher?.connection.bind('state_change', ({ current }: { current: string }) => {
        const was = connected;
        connected = current === 'connected';
        if (was !== connected) {
            if (connected) onChangeCb?.(); // catch up on anything missed while disconnected
            schedule(connected ? 30_000 : 500);
        }
    });

    const user = echo.private(`user.${id.userId}`);
    const change = () => onChangeCb?.();
    user.listen('.sos.raised', change).listen('.sos.updated', change).listen('.mesh.sealed', change);
    for (const kind of SIGNALS) user.listen(`.${kind}`, (e: any) => deliver(kind, e));

    const inst = echo.private(`institution.${id.institutionId}`);
    inst.listen('.announcement.published', change).listen('.safety_check.issued', change);
}

const SIGNALS = ['call.incoming', 'call.signal', 'call.state', 'groupcall.ring', 'groupcall.joined', 'groupcall.left', 'groupcall.signal',
    'status.tagged', 'status.reacted', 'status.commented', 'chat_request.received', 'chat_request.accepted', 'chat_request.updated', 'session.replaced'] as const;

/** One person's signal, from the websocket or the regular check; each is handled once. */
function deliver(kind: string, e: any) {
    if (typeof e?._sig === 'number') {
        if (seen.includes(e._sig)) return;
        seen.push(e._sig);
        if (seen.length > 300) seen.splice(0, 100);
    }
    if (kind.startsWith('call.') || kind.startsWith('chat_request.')) refreshBadges();
    if (kind === 'call.incoming') emit('callSignal', { from: e.caller?.id ?? 0, data: { kind: 'incoming', ...e }, via: 'online' });
    else if (kind === 'call.signal') emit('callSignal', { from: 0, data: { kind: 'signal', ...e }, via: 'online' });
    else if (kind === 'call.state') emit('callSignal', { from: 0, data: { kind: 'state', ...e }, via: 'online' });
    else if (kind.startsWith('groupcall.')) emit('groupCall', { kind: kind.slice(10) as any, data: e });
    else if (kind.startsWith('status.')) emit('statusActivity', { kind: kind.slice(7), ...e });
    else if (kind === 'session.replaced') emit('sessionReplaced', { device: e.device, keep: e.keep ?? null });
    else if (kind.startsWith('chat_request.')) { emit('chatRequest', { kind: kind.slice(13) as any, data: e }); onChangeCb?.(); }
}

function hostOf(url: string) {
    try { return new URL(url).hostname; } catch { return url.replace(/^https?:\/\//, '').split(/[/:]/)[0]; }
}

// ---- The regular check ("anything new?") --------------------------------------------------------------

let pulseStarted = false;
function startPulse() {
    if (!pulseStarted) {
        pulseStarted = true;
        AppState.addEventListener('change', (st) => { active = st === 'active'; if (active) schedule(0); });
    }
    schedule(0);
}

export function realtimeFast(on: boolean) {
    fast = on;
    if (on && !connected) schedule(0);
}

function schedule(ms: number) {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(pulse, ms);
}

async function pulse() {
    if (!onChangeCb) return; // disconnected (offline): resumes on connectRealtime
    try {
        const r = await api<{ cursor: number; signals: { id: number; kind: string; data: any }[]; stamps: Record<string, string> }>(`/pulse?after=${cursor}`);
        if (cursor >= 0) r.signals.forEach((s) => deliver(s.kind, { ...s.data, _sig: s.id }));
        cursor = r.cursor;
        if (stamps) {
            const changed = Object.keys(r.stamps).filter((k) => stamps![k] !== r.stamps[k]);
            if (changed.length) onChangeCb?.();
            if (changed.includes('status')) emit('statusActivity', { kind: 'changed', title: '', status_id: 0 });
            if (changed.includes('conversations')) emit('chatRequest', { kind: 'updated', data: {} });
        }
        stamps = r.stamps;
        if ((r as any).badges) { latestBadges = (r as any).badges; emit('badges', latestBadges); }
    } catch { /* offline or signed out; tried again below */ }
    schedule(connected ? 30_000 : fast ? 1_000 : active ? 4_000 : 30_000);
}

export function subscribeConversation(conversationId: number, onChange: () => void) {
    const ch = echo?.private(`conversation.${conversationId}`);
    ch?.listen('.message.created', onChange).listen('.message.updated', onChange).listen('.message.deleted', onChange);
    return () => echo?.leave(`conversation.${conversationId}`);
}

export function disconnectRealtime() {
    echo?.disconnect();
    echo = null;
    connected = false;
    onChangeCb = null;
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = null;
    cursor = -1;
    stamps = null;
}
