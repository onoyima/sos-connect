import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

/**
 * Everything the phone needs to work with no internet lives here: conversations, messages, the outbox
 * of things waiting for the server, SOS alerts, and the store-and-forward queue of envelopes it carries
 * for other people.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = (async () => {
            const d = await SQLite.openDatabaseAsync('sos-connect.db');
            await d.execAsync(`
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY, type TEXT, name TEXT, posting TEXT, my_role TEXT, member_count INTEGER,
                    unread INTEGER DEFAULT 0, peer_json TEXT, last_message_json TEXT, last_message_at TEXT);
                CREATE TABLE IF NOT EXISTS communities (
                    id INTEGER PRIMARY KEY, name TEXT, description TEXT, parent_id INTEGER, member_count INTEGER);
                CREATE TABLE IF NOT EXISTS messages (
                    client_id TEXT PRIMARY KEY, id INTEGER, conversation_id INTEGER, sender_id INTEGER, sender_name TEXT,
                    type TEXT, body TEXT, meta TEXT, via TEXT, sent_at TEXT, state TEXT DEFAULT 'sent', deleted INTEGER DEFAULT 0);
                CREATE INDEX IF NOT EXISTS messages_conv ON messages (conversation_id, sent_at);
                CREATE TABLE IF NOT EXISTS outbox (
                    client_id TEXT PRIMARY KEY, kind TEXT, payload TEXT, created_at INTEGER, attempts INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS sos (
                    client_id TEXT PRIMARY KEY, uuid TEXT, owner_id INTEGER, owner_name TEXT, category TEXT, json TEXT,
                    status TEXT, raised_at TEXT, mine INTEGER DEFAULT 0, source TEXT);
                CREATE TABLE IF NOT EXISTS envelopes (
                    id TEXT PRIMARY KEY, short TEXT, iid INTEGER, t INTEGER, prio INTEGER, exp INTEGER, hop INTEGER,
                    body TEXT, received_at INTEGER, uploaded INTEGER DEFAULT 0, sender_uid INTEGER);
                CREATE INDEX IF NOT EXISTS envelopes_short ON envelopes (short);
                CREATE INDEX IF NOT EXISTS envelopes_prio ON envelopes (prio DESC, received_at DESC);
                CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, at INTEGER);
                CREATE TABLE IF NOT EXISTS contact_keys (device_id INTEGER PRIMARY KEY, user_id INTEGER, box_public_key TEXT);
                CREATE TABLE IF NOT EXISTS safety_checks (uuid TEXT PRIMARY KEY, json TEXT, answered TEXT);
                CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY, json TEXT, published_at TEXT);
            `);
            await migrate(d);
            return d;
        })();
    }
    return dbPromise;
}

/** Columns added after the first release; each step runs once per phone. */
async function migrate(d: SQLite.SQLiteDatabase) {
    const row = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const v = row?.user_version ?? 0;
    if (v < 2) {
        for (const col of ['auto_type TEXT', 'community_id INTEGER', 'can_post INTEGER DEFAULT 1', 'muted INTEGER DEFAULT 0']) {
            await d.execAsync(`ALTER TABLE conversations ADD COLUMN ${col}`).catch(() => { /* already there */ });
        }
        await d.execAsync('PRAGMA user_version = 2');
    }
    if (v < 3) {
        for (const col of ['reply_to_json TEXT', 'mentions_json TEXT', 'edited INTEGER DEFAULT 0']) {
            await d.execAsync(`ALTER TABLE messages ADD COLUMN ${col}`).catch(() => { /* already there */ });
        }
        await d.execAsync('PRAGMA user_version = 3');
    }
}

export async function kvGet<T>(key: string): Promise<T | null> {
    const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    await (await db()).runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}

/** Logout / account deletion: nothing about the previous user stays on the phone. */
export async function wipeAll(): Promise<void> {
    const d = await db();
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}outbox/`, { idempotent: true }).catch(() => {}); // photos waiting to send
    await d.execAsync('DELETE FROM kv; DELETE FROM conversations; DELETE FROM communities; DELETE FROM messages; DELETE FROM outbox; DELETE FROM sos; DELETE FROM envelopes; DELETE FROM seen; DELETE FROM contact_keys; DELETE FROM safety_checks; DELETE FROM announcements;');
}
