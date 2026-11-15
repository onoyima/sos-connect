import * as Crypto from 'expo-crypto';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import * as FileSystem from 'expo-file-system/legacy';
import { upload, type Picked } from '@/lib/files';
import { keptMentions, type Mention } from './mentions';
import { emit } from '@/lib/events';
import { loadIdentity } from '@/mesh/identity';
import { MeshManager } from '@/mesh/MeshManager';
import { T } from '@/mesh/protocol';
import { SyncEngine } from '@/sync/SyncEngine';

/**
 * Send a text message with whatever is available — at the same time, not one after another:
 *   online  -> straight to the server (instant for everyone, push notifications)
 *   offline -> into the outbox (sent automatically when internet returns) AND out over the mesh,
 *              so members nearby on Bluetooth / Wi-Fi get it now.
 * The phone-generated client_id makes the server store it once, whichever copy arrives first.
 */
export type Quote = { id: number; client_id: string; sender_id: number; sender_name?: string | null; type: string; body: string | null; deleted?: boolean };
export type { Mention };
export type SendOptions = { replyTo?: Quote | null; mentions?: Mention[]; sticker?: string };

export async function sendText(conversationId: number, body: string, opts: SendOptions = {}) {
    const id = await loadIdentity();
    if (!id) throw new Error('Not signed in');
    const clientId = Crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const d = await db();
    const conv = await d.getFirstAsync<{ type: string; peer_json: string | null }>('SELECT type, peer_json FROM conversations WHERE id = ?', conversationId);

    const quote = opts.replyTo && opts.replyTo.id ? { ...opts.replyTo, body: opts.replyTo.body?.slice(0, 160) ?? null } : null;
    const mentions = opts.sticker ? [] : keptMentions(body, opts.mentions ?? []);
    const type = opts.sticker ? 'sticker' : 'text';
    const meta = opts.sticker ? { sticker: opts.sticker } : null;
    await d.runAsync(
        `INSERT INTO messages (client_id, conversation_id, sender_id, sender_name, type, body, meta, via, sent_at, state, reply_to_json, mentions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, 'pending', ?, ?)`,
        clientId, conversationId, id.userId, id.name, type, body, JSON.stringify(meta), sentAt, quote ? JSON.stringify(quote) : null, mentions.length ? JSON.stringify(mentions) : null);
    emit('messages', { conversationId });

    // reply_to / mention_names travel with the mesh copy so nearby phones can show the quote and highlights too.
    const payload = { conversation_id: conversationId, client_id: clientId, type, body, sent_at: sentAt, ...(meta ? { meta } : {}),
        reply_to_id: quote?.id ?? null, mentions: mentions.map((m) => m.id), ...(quote ? { reply_to: quote } : {}), ...(mentions.length ? { mention_names: mentions } : {}) };

    if (SyncEngine.online) {
        try {
            const r = await api<{ message: { id: number } }>(`/conversations/${conversationId}/messages`, { body: payload });
            await d.runAsync("UPDATE messages SET state = 'sent', id = ? WHERE client_id = ?", r.message.id, clientId);
            emit('messages', { conversationId });
            return;
        } catch {
            /* fall through to offline delivery */
        }
    }

    await d.runAsync('INSERT OR REPLACE INTO outbox (client_id, kind, payload, created_at) VALUES (?, ?, ?, ?)', clientId, 'messages', JSON.stringify({ ...payload, meta: { ...(meta ?? {}), via_mesh: true } }), Date.now());

    let meshed = false;
    if (conv?.type === 'direct') {
        // Direct chats are sealed to the other person's phone(s): relaying phones can't read them.
        const peer = conv.peer_json ? JSON.parse(conv.peer_json) : null;
        const keys = peer ? await d.getAllAsync<{ device_id: number; box_public_key: string }>('SELECT device_id, box_public_key FROM contact_keys WHERE user_id = ?', peer.id) : [];
        for (const k of keys) {
            await MeshManager.publish(T.MESSAGE, `u:${peer.id}`, payload, { sealTo: { deviceId: k.device_id, boxKey: k.box_public_key } });
            meshed = true;
        }
    } else {
        await MeshManager.publish(T.MESSAGE, `c:${conversationId}`, payload);
        meshed = true;
    }
    await d.runAsync('UPDATE messages SET state = ? WHERE client_id = ?', meshed ? 'mesh' : 'queued', clientId);
    emit('messages', { conversationId });
}

/**
 * Photos, files and voice notes. With internet they're uploaded and sent straight away. Without it they wait on
 * the phone (a private copy is kept so the original can be deleted) and go out automatically when the internet
 * returns. They never travel over Bluetooth: too big for the mesh.
 */
export async function sendMedia(conversationId: number, file: Picked, type: 'image' | 'file' | 'voice', opts: { caption?: string | null; duration?: number; replyTo?: Quote | null } = {}) {
    const id = await loadIdentity();
    if (!id) throw new Error('Not signed in');
    const clientId = Crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const d = await db();
    const body = type === 'file' ? file.name : type === 'image' ? opts.caption?.trim() || null : null;
    const kept = await keepCopy(file.uri, clientId, file.name);
    const localMeta = { local_uri: kept, size: file.size ?? null, duration: opts.duration ?? null, mime: file.mime };
    const quote = opts.replyTo?.id ? opts.replyTo : null;

    await d.runAsync(
        `INSERT INTO messages (client_id, conversation_id, sender_id, sender_name, type, body, meta, via, sent_at, state, reply_to_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)`,
        clientId, conversationId, id.userId, id.name, type, body, JSON.stringify(localMeta), sentAt, SyncEngine.online ? 'pending' : 'queued', quote ? JSON.stringify(quote) : null);
    const job: MediaJob = { conversation_id: conversationId, client_id: clientId, type, body, sent_at: sentAt, uri: kept, name: file.name, mime: file.mime,
        size: file.size ?? null, duration: opts.duration ?? null, reply_to_id: quote?.id ?? null };
    await d.runAsync('INSERT OR REPLACE INTO outbox (client_id, kind, payload, created_at) VALUES (?, ?, ?, ?)', clientId, 'media', JSON.stringify(job), Date.now());
    emit('messages', { conversationId });

    if (SyncEngine.online) {
        const ok = await deliverMedia(job).catch(() => false);
        if (!ok) await d.runAsync("UPDATE messages SET state = 'queued' WHERE client_id = ?", clientId);
        emit('messages', { conversationId });
    }
}

export type MediaJob = {
    conversation_id: number; client_id: string; type: string; body: string | null; sent_at: string; uri: string; name: string; mime: string;
    size: number | null; duration: number | null; reply_to_id: number | null;
};

/** Uploads one waiting photo/file/voice note and posts its message. True when done (or rejected for good). */
export async function deliverMedia(job: MediaJob): Promise<boolean> {
    const d = await db();
    try {
        const up = await upload({ uri: job.uri, name: job.name, mime: job.mime, size: job.size });
        const meta = { path: up.path, size: up.size, ...(job.duration ? { duration: Math.round(job.duration) } : {}) };
        const r = await api<{ message: { id: number } }>(`/conversations/${job.conversation_id}/messages`,
            { body: { client_id: job.client_id, type: job.type, body: job.body, meta, sent_at: job.sent_at, reply_to_id: job.reply_to_id } });
        await d.runAsync("UPDATE messages SET state = 'sent', id = ?, meta = ? WHERE client_id = ?", r.message.id, JSON.stringify({ ...meta, local_uri: job.uri, mime: job.mime }), job.client_id);
        await d.runAsync('DELETE FROM outbox WHERE client_id = ?', job.client_id);
        return true;
    } catch (e) {
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
            // Refused (e.g. removed from the group, file too big): stop trying and show it as not delivered.
            await d.runAsync("UPDATE messages SET state = 'failed' WHERE client_id = ?", job.client_id);
            await d.runAsync('DELETE FROM outbox WHERE client_id = ?', job.client_id);
            return true;
        }
        await d.runAsync('UPDATE outbox SET attempts = attempts + 1 WHERE client_id = ?', job.client_id);
        return false;
    } finally {
        emit('messages', { conversationId: job.conversation_id });
    }
}

/** A private copy in the app's own folder, so a queued file survives the gallery or cache being cleaned. */
async function keepCopy(uri: string, clientId: string, name: string): Promise<string> {
    try {
        const dir = `${FileSystem.documentDirectory}outbox/`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        const target = `${dir}${clientId}${ext}`;
        await FileSystem.copyAsync({ from: uri, to: target });
        return target;
    } catch {
        return uri;
    }
}
