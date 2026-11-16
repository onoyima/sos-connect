import { api } from './api';
import { getEcho } from './echo';
import type { ChatMessage, SharedProps } from '@/types';

/**
 * Live updates for every page, in one place.
 *
 * - When the websocket server (Reverb) is reachable, everything arrives instantly over it: messages in every chat
 *   I'm in, calls, chat requests, SOS, notices, safety checks and status activity.
 * - When it isn't (not started, blocked, connection dropped), the page asks the server "anything new?" every few
 *   seconds instead (every second during a call), so nothing waits for a manual refresh.
 * - The red counts (unread chats, missed calls, chat requests) are kept up to date both ways.
 *
 *   listenUser('call.incoming', fn)        per-person events (calls, chat requests, status activity)
 *   onMessage(fn)                          any message created/edited/deleted in my chats
 *   onChange('status', fn)                 "something changed, reload": messages, conversations, sos, announcements, safety, status
 *   onBadges(fn)                           the red counts
 */
export type Topic = 'messages' | 'conversations' | 'sos' | 'announcements' | 'safety' | 'status';
export type Badges = { chats: number; calls: number; requests: number };
type Handler = (data: any) => void;
type Channel = ReturnType<NonNullable<ReturnType<typeof getEcho>>['private']>;

const userHandlers = new Map<string, Set<Handler>>();
const instHandlers = new Map<string, Set<Handler>>();
const topicHandlers = new Map<Topic, Set<(stamp: string, before: string) => void>>();
const messageHandlers = new Set<(kind: string, m: ChatMessage) => void>();
const badgeHandlers = new Set<(b: Badges) => void>();
const stateListeners = new Set<(live: boolean) => void>();
const userBound = new Set<string>();
const instBound = new Set<string>();
const convChannels = new Map<number, Channel>();
const seen: number[] = [];

let echo: ReturnType<typeof getEcho> = null;
let userChannel: Channel | null = null;
let instChannel: Channel | null = null;
let connected = false;
let started = false;
let cursor = -1;
let stamps: Partial<Record<Topic, string>> | null = null;
let timer: number | null = null;
let fast = 0;
let badges: Badges = { chats: 0, calls: 0, requests: 0 };
let badgeTimer: number | null = null;

const safely = (what: string, fn: () => void) => { try { fn(); } catch (e) { console.error('[live]', what, e); } };
const fire = (t: Topic, stamp = '', before = '') => topicHandlers.get(t)?.forEach((fn) => safely(t, () => fn(stamp, before)));

// Institution-wide changes can come in bursts (many likes at once): pages reload at most once per second.
const soon = new Map<Topic, number>();
const fireSoon = (t: Topic) => {
    if (soon.has(t)) return;
    soon.set(t, window.setTimeout(() => { soon.delete(t); fire(t); }, 800));
};

const deliver = (kind: string, data: any) => {
    const sig = typeof data?._sig === 'number' ? data._sig : null;
    if (sig !== null) {
        if (seen.includes(sig)) return; // already arrived the other way
        seen.push(sig);
        if (seen.length > 300) seen.splice(0, 100);
    }
    userHandlers.get(kind)?.forEach((fn) => safely(kind, () => fn(data)));
    if (kind.startsWith('call.') || kind.startsWith('chat_request.')) refreshBadges();
    if (kind.startsWith('chat_request.')) fire('conversations');
};

const bindUser = (kind: string) => {
    if (!userChannel || userBound.has(kind)) return;
    userBound.add(kind);
    userChannel.listen(`.${kind}`, (data: any) => deliver(kind, data));
};
const bindInst = (kind: string) => {
    if (!instChannel || instBound.has(kind)) return;
    instBound.add(kind);
    instChannel.listen(`.${kind}`, (data: any) => instHandlers.get(kind)?.forEach((fn) => safely(kind, () => fn(data))));
};

/** Called once by the layout of signed-in pages. */
export function startLive(reverb: SharedProps['reverb'], userId: number, institutionId: number | null) {
    if (started) return;
    started = true;
    echo = getEcho(reverb);
    if (echo) {
        userChannel = echo.private(`user.${userId}`);
        if (institutionId) instChannel = echo.private(`institution.${institutionId}`);
        userHandlers.forEach((_, kind) => bindUser(kind));
        // Things every page should react to at once, not only when the regular check notices.
        ['sos.raised', 'sos.updated'].forEach((k) => { bindUser(k); listenUser(k, () => fire('sos')); });
        ([['announcement.published', 'announcements'], ['safety_check.issued', 'safety'], ['status.changed', 'status']] as const)
            .forEach(([k, t]) => listenInstitution(k, () => fireSoon(t)));
        instHandlers.forEach((_, kind) => bindInst(kind));

        const pusher = (echo.connector as unknown as { pusher?: { connection: { state: string; bind: (e: string, f: (s: { current: string }) => void) => void } } }).pusher;
        connected = pusher?.connection.state === 'connected';
        pusher?.connection.bind('state_change', ({ current }) => {
            const was = connected;
            connected = current === 'connected';
            if (was !== connected) {
                stateListeners.forEach((f) => f(connected));
                schedule(connected ? 0 : 500); // catch up straight away after a reconnect, or start checking
            }
        });
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
    window.addEventListener('focus', () => schedule(0));
    schedule(0);
}

/** Listens to every chat I'm in (the list comes with each check, so new groups are picked up too). */
function watchConversations(ids: number[]) {
    if (!echo) return;
    const want = new Set(ids);
    convChannels.forEach((_, id) => { if (!want.has(id)) { echo!.leave(`conversation.${id}`); convChannels.delete(id); } });
    for (const id of ids) {
        if (convChannels.has(id)) continue;
        const ch = echo.private(`conversation.${id}`);
        for (const kind of ['message.created', 'message.updated', 'message.deleted']) {
            ch.listen(`.${kind}`, (m: ChatMessage) => {
                messageHandlers.forEach((fn) => safely(kind, () => fn(kind, m)));
                refreshBadges();
            });
        }
        convChannels.set(id, ch);
    }
}

let pushOk = true;
const interval = () => {
    if (fast > 0) return 1_000;          // in a call: setup messages must arrive quickly, live connection or not
    if (connected && pushOk) return 30_000;
    return document.hidden ? 8_000 : 3_000;
};

function schedule(ms: number) {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(pulse, ms);
}

async function pulse() {
    try {
        const r = await api<{ cursor: number; signals: { id: number; kind: string; data: any }[]; stamps: Record<Topic, string>; badges: Badges; conversation_ids: number[]; push_ok?: boolean }>(`/pulse?after=${cursor}`);
        pushOk = r.push_ok !== false;
        if (cursor >= 0) r.signals.forEach((s) => deliver(s.kind, { ...s.data, _sig: s.id }));
        cursor = r.cursor;
        if (stamps) {
            (Object.keys(r.stamps) as Topic[]).forEach((t) => {
                const before = stamps![t] ?? '';
                if (before !== r.stamps[t]) fire(t, r.stamps[t], before);
            });
        }
        stamps = r.stamps;
        setBadges(r.badges);
        watchConversations(r.conversation_ids ?? []);
    } catch {
        // Offline or signed out: api() already handles an ended session; try again later.
    }
    schedule(interval());
}

function setBadges(b: Badges | undefined) {
    if (!b) return;
    badges = b;
    badgeHandlers.forEach((fn) => safely('badges', () => fn(b)));
}

/** Fetches the red counts soon (several triggers in a row cause one request). */
export function refreshBadges() {
    if (badgeTimer) window.clearTimeout(badgeTimer);
    badgeTimer = window.setTimeout(() => { api<{ badges: Badges }>('/badges').then((r) => setBadges(r.badges)).catch(() => {}); }, 400);
}

export function listenUser(kind: string, fn: Handler): () => void {
    if (!userHandlers.has(kind)) userHandlers.set(kind, new Set());
    userHandlers.get(kind)!.add(fn);
    bindUser(kind);
    return () => { userHandlers.get(kind)?.delete(fn); };
}

export function listenInstitution(kind: string, fn: Handler): () => void {
    if (!instHandlers.has(kind)) instHandlers.set(kind, new Set());
    instHandlers.get(kind)!.add(fn);
    bindInst(kind);
    return () => { instHandlers.get(kind)?.delete(fn); };
}

export function onMessage(fn: (kind: string, m: ChatMessage) => void): () => void {
    messageHandlers.add(fn);
    return () => { messageHandlers.delete(fn); };
}

export function onChange(topic: Topic, fn: (stamp: string, before: string) => void): () => void {
    if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
    topicHandlers.get(topic)!.add(fn);
    return () => { topicHandlers.get(topic)?.delete(fn); };
}

export function onBadges(fn: (b: Badges) => void): () => void {
    badgeHandlers.add(fn);
    fn(badges);
    return () => { badgeHandlers.delete(fn); };
}

/** Check every second while a call is being set up or running, so call signals never wait for the 30-second check. */
export function liveFast(on: boolean) {
    fast = Math.max(0, fast + (on ? 1 : -1));
    if (on) schedule(0); // start checking every second now (the live connection may look open while the server can't push)
}

export const isLive = () => connected;

export function onLiveState(fn: (live: boolean) => void): () => void {
    stateListeners.add(fn);
    return () => { stateListeners.delete(fn); };
}
