import * as Notifications from 'expo-notifications';
import { MeshNearby } from 'mesh-nearby';
import { config } from '@/config';
import { deviceKeys } from '@/crypto/keys';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { fromBase64, toBase64 } from '@/lib/base64';
import { emit } from '@/lib/events';
import { loadIdentity, meshKeyBytes, type MeshIdentity } from './identity';
import { LanTransport } from './lan';
import { decodeFrame, encodeFrame, open, seal, shortId, T, verifyEnvelope, type Envelope, type Frame } from './protocol';

type Peer = { id: string; via: 'nearby' | 'lan'; send: (b: Uint8Array) => Promise<void>; hello?: Extract<Frame, { k: 'hello' }> };

const PRIORITY: Record<number, number> = { [T.SOS]: 9, [T.SOS_UPDATE]: 8, [T.SAFETY_RESPONSE]: 7, [T.ANNOUNCEMENT]: 6, [T.MESSAGE]: 3, [T.READ_RECEIPT]: 1 };
/** Certificates carry "+notices" when the holder may post institution-wide notices (signed by the server). */
const canAnnounce = (role: string) => role.endsWith('+notices');

/**
 * Store-and-forward mesh ("epidemic routing" with limits):
 *  - every envelope is signed by its sender's certified device key and checked by every hop;
 *  - each phone keeps envelopes until they expire and passes them to every new peer it meets,
 *    highest priority (SOS) first, decrementing a hop counter so nothing circulates forever;
 *  - any phone that gets internet uploads what it carries ("gateway"), so an alert raised in a
 *    dead zone reaches the server as soon as ONE phone in the chain gets a signal;
 *  - phones carry other institutions' SOS envelopes too (they can't read them), so help can travel
 *    across campuses that share a neighbourhood.
 */
class MeshManagerImpl {
    private peers = new Map<string, Peer>();
    private lan = new LanTransport({
        onPeer: (p) => this.addPeer({ id: p.id, via: 'lan', send: p.send }),
        onPeerLost: (id) => this.removePeer(id),
        onData: (id, bytes) => this.onBytes(id, bytes),
    });
    private identity: MeshIdentity | null = null;
    private running = false;
    private timers: ReturnType<typeof setInterval>[] = [];
    private rate = new Map<number, number[]>();
    private subs: { remove: () => void }[] = [];

    get peerList() {
        return [...this.peers.values()].map((p) => ({ id: p.id, via: p.via, name: p.hello?.name ?? '…', sameInstitution: p.hello?.iid === this.identity?.institutionId }));
    }

    async start() {
        if (this.running) return;
        this.identity = await loadIdentity();
        if (!this.identity) return;
        this.running = true;
        const tag = `d${this.identity.deviceId}`;

        if (MeshNearby.available()) {
            this.subs.push(
                MeshNearby.onPeer((e) => this.addPeer({ id: `nb:${e.endpointId}`, via: 'nearby', send: (b) => MeshNearby.send(e.endpointId, toBase64(b)) })),
                MeshNearby.onPeerLost((e) => this.removePeer(`nb:${e.endpointId}`)),
                MeshNearby.onPayload((e) => this.onBytes(`nb:${e.endpointId}`, fromBase64(e.data))),
            );
            MeshNearby.start(config.mesh.serviceId, tag).catch((err) => console.warn('[mesh] nearby', err));
        }
        try { this.lan.start(tag); } catch (err) { console.warn('[mesh] lan', err); }

        this.timers.push(setInterval(() => this.peers.forEach((p) => this.sendInventory(p)), 30_000));
        this.timers.push(setInterval(() => this.purge(), 10 * 60_000));
    }

    stop() {
        this.running = false;
        this.timers.forEach(clearInterval);
        this.timers = [];
        this.subs.forEach((s) => s.remove());
        this.subs = [];
        MeshNearby.stop();
        this.lan.stop();
        this.peers.clear();
        emit('peers', undefined);
    }

    async reloadIdentity() {
        this.identity = await loadIdentity();
    }

    /* ---------- sending things I created ---------- */

    async publish(type: number, to: string, payload: unknown, opts: { sealTo?: { deviceId: number; boxKey: string } } = {}): Promise<Envelope | null> {
        const id = this.identity ?? (await loadIdentity());
        if (!id) return null;
        const keys = await deviceKeys();
        const isSos = type === T.SOS || type === T.SOS_UPDATE;
        const common = {
            cert: id.certificate, signSecretKey: keys.sign.secretKey, type, to, payload,
            lifetimeMs: isSos ? config.mesh.sosLifetimeMs : config.mesh.messageLifetimeMs,
            hops: isSos ? config.mesh.sosTtlHops : config.mesh.defaultTtlHops,
        };
        const e = opts.sealTo
            ? seal({ ...common, enc: 'b', recipientDeviceId: opts.sealTo.deviceId, recipientBoxKey: fromBase64(opts.sealTo.boxKey), boxSecretKey: keys.box.secretKey })
            : seal({ ...common, enc: 'k', keyId: id.currentKid, key: meshKeyBytes(id)[id.currentKid] });

        const bytes = encodeFrame({ k: 'env', e });
        if (bytes.length > config.mesh.maxEnvelopeBytes) throw new Error('Too large to send without internet. Text only, please.');

        await this.store(e, id.userId);
        await this.markSeen(e.id);
        this.flood(e, null);
        return e;
    }

    /* ---------- peers ---------- */

    private addPeer(p: Peer) {
        this.peers.set(p.id, p);
        const id = this.identity!;
        this.sendFrame(p, { k: 'hello', uid: id.userId, iid: id.institutionId, did: id.deviceId, name: id.name.split(' ')[0] });
        this.sendInventory(p);
        emit('peers', undefined);
    }

    private removePeer(id: string) {
        if (this.peers.delete(id)) emit('peers', undefined);
    }

    private async sendFrame(p: Peer, f: Frame) {
        try { await p.send(encodeFrame(f)); } catch { this.removePeer(p.id); }
    }

    private async sendInventory(p: Peer) {
        const rows = await (await db()).getAllAsync<{ short: string }>(
            'SELECT short FROM envelopes WHERE exp > ? AND hop > 0 ORDER BY prio DESC, received_at DESC LIMIT ?', Date.now(), config.mesh.inventoryLimit);
        if (rows.length) this.sendFrame(p, { k: 'inv', ids: rows.map((r) => r.short) });
    }

    private async onBytes(peerId: string, bytes: Uint8Array) {
        const p = this.peers.get(peerId);
        const f = decodeFrame(bytes);
        if (!p || !f) return;
        const d = await db();
        switch (f.k) {
            case 'hello':
                p.hello = f;
                emit('peers', undefined);
                break;
            case 'inv': {
                const ids = f.ids.filter((x) => /^[0-9a-f]{16}$/.test(x)).slice(0, config.mesh.inventoryLimit);
                if (!ids.length) break;
                const have = new Set((await d.getAllAsync<{ short: string }>(
                    `SELECT short FROM envelopes WHERE short IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => r.short));
                const seen = new Set((await d.getAllAsync<{ id: string }>(
                    `SELECT id FROM seen WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => r.id));
                const want = ids.filter((x) => !have.has(x) && !seen.has(x));
                if (want.length) this.sendFrame(p, { k: 'want', ids: want });
                break;
            }
            case 'want': {
                const ids = f.ids.slice(0, config.mesh.inventoryLimit);
                const rows = await d.getAllAsync<{ body: string; hop: number }>(
                    `SELECT body, hop FROM envelopes WHERE short IN (${ids.map(() => '?').join(',')}) AND exp > ? AND hop > 0 ORDER BY prio DESC`, ...ids, Date.now());
                for (const r of rows) this.sendFrame(p, { k: 'env', e: { ...JSON.parse(r.body), hop: r.hop - 1 } });
                break;
            }
            case 'env':
                await this.receive(f.e, p);
                break;
            case 'call':
                if (this.identity && f.to === this.identity.userId) emit('callSignal', { from: f.from, data: f.data, via: 'lan' });
                break;
        }
    }

    /** Send LAN call signalling straight to the peer on the same Wi-Fi (no server involved). */
    sendCallSignal(toUserId: number, data: unknown): boolean {
        const p = [...this.peers.values()].find((x) => x.via === 'lan' && x.hello?.uid === toUserId);
        if (!p || !this.identity) return false;
        this.sendFrame(p, { k: 'call', to: toUserId, from: this.identity.userId, data });
        return true;
    }

    hasLanPeer(userId: number) {
        return [...this.peers.values()].some((x) => x.via === 'lan' && x.hello?.uid === userId);
    }

    /* ---------- receiving ---------- */

    private async receive(e: Envelope, from: Peer) {
        const me = this.identity;
        if (!me || !e?.id || (await this.isSeen(e.id))) return;
        await this.markSeen(e.id);

        const check = verifyEnvelope(e, me.platformPublicKey);
        if (!check.ok) return; // forged, expired or tampered: drop silently, never relay
        if (!this.withinRate(e.cert.uid, e.t)) return;

        const mine = e.iid === me.institutionId;
        const carry = e.hop > 0 && (mine ? e.t !== T.CALL_SIGNAL : (e.t === T.SOS || e.t === T.SOS_UPDATE));
        if (carry) {
            await this.store(e, e.cert.uid);
            this.flood(e, from.id);
        }
        if (mine) {
            const payload = open(e, { meshKeys: meshKeyBytes(me), deviceId: me.deviceId, boxSecretKey: (await deviceKeys()).box.secretKey });
            if (payload) await this.deliver(e, payload as Record<string, any>);
        }
    }

    private async deliver(e: Envelope, p: Record<string, any>) {
        const d = await db();
        const me = this.identity!;
        if (e.cert.uid === me.userId) return;

        if (e.t === T.MESSAGE) {
            const conversationId = e.to.startsWith('c:') ? Number(e.to.slice(2)) : Number(p.conversation_id);
            const known = await d.getFirstAsync('SELECT id FROM conversations WHERE id = ?', conversationId);
            if (!known || !p.client_id) return; // not a conversation I'm in
            await d.runAsync(
                `INSERT OR IGNORE INTO messages (client_id, conversation_id, sender_id, sender_name, type, body, meta, via, sent_at, state, reply_to_json, mentions_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'mesh', ?, 'sent', ?, ?)`,
                p.client_id, conversationId, e.cert.uid, e.cert.name, p.type ?? 'text', p.body ?? null, JSON.stringify(p.meta ?? null), p.sent_at ?? new Date(e.ts).toISOString(),
                p.reply_to ? JSON.stringify(p.reply_to) : null, Array.isArray(p.mention_names) && p.mention_names.length ? JSON.stringify(p.mention_names) : null);
            await d.runAsync('UPDATE conversations SET unread = unread + 1, last_message_at = ? WHERE id = ?', new Date(e.ts).toISOString(), conversationId);
            emit('messages', { conversationId });
            emit('conversations', undefined);
            notify(`${e.cert.name} (offline network)`, p.type === 'text' ? String(p.body ?? '').slice(0, 100) : 'New message', false);
        } else if (e.t === T.SOS) {
            await d.runAsync(
                `INSERT OR IGNORE INTO sos (client_id, owner_id, owner_name, category, json, status, raised_at, mine, source) VALUES (?, ?, ?, ?, ?, 'open', ?, 0, 'mesh')`,
                p.client_id, e.cert.uid, e.cert.name, p.category ?? 'other', JSON.stringify(p), p.raised_at ?? new Date(e.ts).toISOString());
            emit('sos', undefined);
            notify(`SOS nearby: ${e.cert.name}`, `${p.category ?? 'Help needed'}${p.location_label ? ` · ${p.location_label}` : ''}. Open SOS Connect.`, true);
        } else if (e.t === T.SOS_UPDATE) {
            await d.runAsync('UPDATE sos SET status = ? WHERE client_id = ? OR uuid = ?', p.action === 'cancelled' || p.action === 'resolved' ? p.action : 'responding', p.alert_client_id ?? '', p.alert_uuid ?? '');
            emit('sos', undefined);
        } else if (e.t === T.ANNOUNCEMENT && canAnnounce(e.cert.role)) {
            await d.runAsync('INSERT OR IGNORE INTO announcements (id, json, published_at) VALUES (?, ?, ?)', -e.ts, JSON.stringify({ ...p, author: { name: e.cert.name, role: e.cert.role } }), new Date(e.ts).toISOString());
            emit('announcements', undefined);
            notify(`${e.cert.name}: ${p.title ?? 'Announcement'}`, String(p.body ?? '').slice(0, 120), p.priority === 'urgent');
        }
    }

    /* ---------- storage ---------- */

    private async store(e: Envelope, senderUid: number) {
        await (await db()).runAsync(
            `INSERT OR IGNORE INTO envelopes (id, short, iid, t, prio, exp, hop, body, received_at, uploaded, sender_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            e.id, shortId(e.id), e.iid, e.t, PRIORITY[e.t] ?? 0, e.exp, e.hop, JSON.stringify(e), Date.now(), senderUid);
    }

    private flood(e: Envelope, exceptPeer: string | null) {
        if (e.hop <= 0) return;
        const next = { ...e, hop: e.hop - 1 };
        this.peers.forEach((p) => { if (p.id !== exceptPeer) this.sendFrame(p, { k: 'env', e: next }); });
    }

    private async isSeen(id: string) {
        return !!(await (await db()).getFirstAsync('SELECT id FROM seen WHERE id = ?', shortId(id)));
    }

    private async markSeen(id: string) {
        await (await db()).runAsync('INSERT OR IGNORE INTO seen (id, at) VALUES (?, ?)', shortId(id), Date.now());
    }

    /** A single phone can't flood the mesh: 60 envelopes / 10 min per sender, 5 SOS / 10 min. */
    private withinRate(uid: number, type: number) {
        const now = Date.now();
        const key = type === T.SOS ? -uid : uid;
        const list = (this.rate.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
        if (list.length >= (type === T.SOS ? 5 : 60)) return false;
        list.push(now);
        this.rate.set(key, list);
        return true;
    }

    private async purge() {
        const d = await db();
        await d.runAsync('DELETE FROM envelopes WHERE exp < ?', Date.now());
        await d.runAsync('DELETE FROM seen WHERE at < ?', Date.now() - 4 * 86400_000);
        // Hard cap so carried traffic never eats the phone's storage.
        await d.runAsync('DELETE FROM envelopes WHERE id IN (SELECT id FROM envelopes ORDER BY prio ASC, received_at ASC LIMIT max(0, (SELECT count(*) FROM envelopes) - 5000))');
    }

    /** Sealed envelopes that reached the server through someone else's phone, fetched by the sync engine. */
    async ingestFromServer(e: Envelope) {
        await this.receive(e, { id: 'server', via: 'lan', send: async () => {} });
    }

    /* ---------- gateway: upload what I carry once I have internet ---------- */

    async uploadCarried(): Promise<number> {
        const d = await db();
        const rows = await d.getAllAsync<{ id: string; body: string }>(
            'SELECT id, body FROM envelopes WHERE uploaded = 0 AND exp > ? AND t != ? ORDER BY prio DESC LIMIT 200', Date.now(), T.CALL_SIGNAL);
        if (!rows.length) return 0;
        const r = await api<{ results: Record<string, string> }>('/mesh/relay', { body: { envelopes: rows.map((x) => JSON.parse(x.body)) }, timeoutMs: 30000 });
        const done = Object.keys(r.results);
        if (done.length) await d.runAsync(`UPDATE envelopes SET uploaded = 1 WHERE id IN (${done.map(() => '?').join(',')})`, ...done);
        return done.length;
    }
}

async function notify(title: string, body: string, urgent: boolean) {
    try {
        await Notifications.scheduleNotificationAsync({
            content: { title, body, sound: 'default', priority: urgent ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.DEFAULT },
            trigger: urgent ? { channelId: 'sos' } as never : null,
        });
    } catch { /* notifications disabled */ }
}

export const MeshManager = new MeshManagerImpl();
