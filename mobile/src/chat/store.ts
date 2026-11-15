import type { SQLiteDatabase } from 'expo-sqlite';

/** A message as the server sends it (sync, history, search, realtime). */
export type ServerMessage = {
    id: number; client_id: string; conversation_id: number; sender_id: number; sender_name?: string | null; type: string; body: string | null;
    meta: unknown; via: string; sent_at: string; edited?: boolean; deleted?: boolean;
    reply_to?: unknown; mentions?: unknown[];
};

/** Saves a server message on the phone, keeping the local file preview of something I just sent. */
export async function saveServerMessage(d: SQLiteDatabase, m: ServerMessage) {
    await d.runAsync(
        `INSERT INTO messages (client_id, id, conversation_id, sender_id, sender_name, type, body, meta, via, sent_at, state, deleted, reply_to_json, mentions_json, edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET id = excluded.id, body = excluded.body, state = 'sent', deleted = excluded.deleted,
            meta = CASE WHEN excluded.meta IS NULL OR excluded.meta = 'null' THEN messages.meta ELSE excluded.meta END,
            reply_to_json = excluded.reply_to_json, mentions_json = excluded.mentions_json, edited = excluded.edited`,
        m.client_id, m.id, m.conversation_id, m.sender_id, m.sender_name ?? '', m.type, m.body, JSON.stringify(m.meta ?? null), m.via, m.sent_at,
        m.deleted ? 1 : 0, m.reply_to ? JSON.stringify(m.reply_to) : null, m.mentions?.length ? JSON.stringify(m.mentions) : null, m.edited ? 1 : 0);
}
