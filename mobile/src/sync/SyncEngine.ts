import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { db, kvGet, kvSet } from '@/db/database';
import { api, ApiError } from '@/lib/api';
import { emit } from '@/lib/events';
import { certificateNeedsRenewal, loadIdentity, registerDevice, updateMeshKeys } from '@/mesh/identity';
import { MeshManager } from '@/mesh/MeshManager';
import type { Envelope } from '@/mesh/protocol';
import { saveServerMessage } from '@/chat/store';
import { deliverMedia } from '@/chat/send';
import { connectRealtime, disconnectRealtime } from './realtime';

/**
 * Online half of "works with or without internet":
 *  - one POST flushes everything written offline (SOS first), one GET pulls only what changed;
 *  - uploads envelopes this phone carried for others (gateway);
 *  - no polling: it runs when the network comes back, when the app returns to the foreground,
 *    when a realtime event arrives, and every 2 minutes as a safety net while open.
 */
class SyncEngineImpl {
    online = false;
    /** True once the first full sync after opening has finished (or failed) — the chats list shows a loader until then. */
    firstDone = false;
    private running = false;
    private again = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private unsub: (() => void)[] = [];

    start() {
        this.unsub.push(NetInfo.addEventListener((s) => {
            const now = !!s.isConnected && s.isInternetReachable !== false;
            if (now !== this.online) {
                this.online = now;
                emit('online', now);
                if (now) { this.run(); connectRealtime(() => this.run()); } else { disconnectRealtime(); }
            }
        }));
        const sub = AppState.addEventListener('change', (st) => st === 'active' && this.run());
        this.unsub.push(() => sub.remove());
        this.timer = setInterval(() => this.run(), 120_000);
    }

    stop() {
        this.unsub.forEach((u) => u());
        this.unsub = [];
        if (this.timer) clearInterval(this.timer);
        disconnectRealtime();
    }

    /** Safe to call any time; concurrent calls collapse into one extra pass. */
    async run(): Promise<void> {
        if (!this.online) return;
        if (this.running) { this.again = true; return; }
        this.running = true;
        try {
            await this.renewCertificateIfNeeded();
            await this.pushOutbox();
            await this.pull();
            await MeshManager.uploadCarried().catch(() => 0);
            await this.pullSealed();
            await this.refreshContactKeys();
        } catch (e) {
            if (e instanceof ApiError && e.status === 401) emit('online', false);
            console.warn('[sync]', (e as Error).message);
        } finally {
            this.running = false;
            if (!this.firstDone) { this.firstDone = true; emit('conversations', undefined); }
            if (this.again) { this.again = false; this.run(); }
        }
    }

    private async renewCertificateIfNeeded() {
        const id = await loadIdentity();
        if (id && certificateNeedsRenewal(id)) {
            await registerDevice(null);
            await MeshManager.reloadIdentity();
        }
    }

    private async pushOutbox() {
        const d = await db();
        // Photos, files and voice notes written offline: uploaded one by one (they can't go in the batch).
        const media = await d.getAllAsync<{ payload: string }>("SELECT payload FROM outbox WHERE kind = 'media' ORDER BY created_at LIMIT 20");
        for (const m of media) {
            if (!(await deliverMedia(JSON.parse(m.payload)))) break; // network trouble: try the rest next time
        }

        const rows = await d.getAllAsync<{ client_id: string; kind: string; payload: string }>("SELECT client_id, kind, payload FROM outbox WHERE kind != 'media' ORDER BY created_at LIMIT 200");
        if (!rows.length) return;
        const body: Record<string, unknown[]> = { messages: [], sos: [], sos_updates: [], safety: [], reads: [] };
        for (const r of rows) (body[r.kind] ??= []).push(JSON.parse(r.payload));

        const res = await api<{ results: Record<string, Record<string, { ok: boolean; id?: number; uuid?: string; error?: string }>> }>('/sync', { body, timeoutMs: 30000 });
        for (const r of rows) {
            const result = res.results[r.kind]?.[r.client_id];
            if (r.kind === 'messages' && result) {
                await d.runAsync('UPDATE messages SET state = ?, id = COALESCE(?, id) WHERE client_id = ?', result.ok ? 'sent' : 'failed', result.id ?? null, r.client_id);
            }
            if (r.kind === 'sos' && result?.uuid) {
                await d.runAsync('UPDATE sos SET uuid = ? WHERE client_id = ?', result.uuid, r.client_id);
            }
            // Rejected items (e.g. removed from the group) are dropped, not retried forever.
            await d.runAsync('DELETE FROM outbox WHERE client_id = ?', r.client_id);
        }
        emit('conversations', undefined);
        emit('sos', undefined);
    }

    async pull() {
        const d = await db();
        let cursor = (await kvGet<number>('sync.cursor')) ?? 0;
        const since = (await kvGet<string>('sync.since')) ?? undefined;
        let more = true;
        let first = true;
        while (more) {
            const r = await api<any>(`/sync?cursor=${cursor}${since ? `&since=${encodeURIComponent(since)}` : ''}${first ? '&keys=1' : ''}`);
            first = false;
            const touched = new Set<number>();
            for (const m of r.messages) {
                await saveServerMessage(d, m);
                touched.add(m.conversation_id);
            }
            for (const s of r.sos) {
                await d.runAsync(
                    `INSERT INTO sos (client_id, uuid, owner_id, owner_name, category, json, status, raised_at, mine, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'server') ON CONFLICT(client_id) DO UPDATE SET uuid = excluded.uuid, json = excluded.json, status = excluded.status`,
                    s.client_id, s.uuid, s.user?.id ?? null, s.user?.name ?? null, s.category, JSON.stringify(s), s.status, s.raised_at);
            }
            for (const c of r.safety_checks) await d.runAsync('INSERT OR IGNORE INTO safety_checks (uuid, json) VALUES (?, ?)', c.uuid, JSON.stringify(c));
            for (const a of r.announcements) await d.runAsync('INSERT OR REPLACE INTO announcements (id, json, published_at) VALUES (?, ?, ?)', a.id, JSON.stringify(a), a.published_at);
            if (r.mesh_keys) await updateMeshKeys(r.mesh_keys);
            cursor = r.cursor;
            more = r.more;
            await kvSet('sync.cursor', cursor);
            await kvSet('sync.since', r.server_time);
            touched.forEach((id) => emit('messages', { conversationId: id }));
        }
        await this.refreshConversations().catch(() => { /* chat disabled for this account (e.g. under-18 without consent) */ });
        emit('sos', undefined);
        emit('safety', undefined);
        emit('announcements', undefined);
    }

    async refreshConversations() {
        const d = await db();
        const r = await api<{ conversations: any[]; communities?: any[] }>('/conversations');
        await d.withTransactionAsync(async () => {
            await d.runAsync('DELETE FROM conversations');
            for (const c of r.conversations) {
                await d.runAsync(
                    `INSERT INTO conversations (id, type, name, posting, my_role, member_count, unread, peer_json, last_message_json, last_message_at, auto_type, community_id, can_post, muted)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    c.id, c.type, c.name, c.posting, c.my_role, c.member_count, c.unread, JSON.stringify(c.peer), JSON.stringify(c.last_message), c.last_message_at,
                    c.auto_type ?? null, c.community_id ?? null, c.can_post === false ? 0 : 1, c.muted ? 1 : 0);
            }
            await d.runAsync('DELETE FROM communities');
            for (const c of r.communities ?? []) {
                await d.runAsync('INSERT INTO communities (id, name, description, parent_id, member_count) VALUES (?, ?, ?, ?, ?)',
                    c.id, c.name, c.description ?? null, c.parent_id ?? null, c.member_count ?? 0);
            }
        });
        emit('conversations', undefined);
    }

    private async pullSealed() {
        let after = (await kvGet<number>('sync.sealedAfter')) ?? 0;
        const r = await api<{ after: number; envelopes: Envelope[] }>(`/mesh/inbox?after=${after}`);
        for (const e of r.envelopes) await MeshManager.ingestFromServer(e);
        after = r.after;
        await kvSet('sync.sealedAfter', after);
    }

    private async refreshContactKeys() {
        const last = (await kvGet<number>('sync.keysAt')) ?? 0;
        if (Date.now() - last < 6 * 3600_000) return;
        const r = await api<{ keys: { user_id: number; device_id: number; box_public_key: string }[] }>('/mesh/contact-keys');
        const d = await db();
        await d.runAsync('DELETE FROM contact_keys');
        for (const k of r.keys) await d.runAsync('INSERT INTO contact_keys (device_id, user_id, box_public_key) VALUES (?, ?, ?)', k.device_id, k.user_id, k.box_public_key);
        await kvSet('sync.keysAt', Date.now());
    }
}

export const SyncEngine = new SyncEngineImpl();
