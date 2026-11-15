import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { emit } from '@/lib/events';
import { loadIdentity } from '@/mesh/identity';
import { MeshManager } from '@/mesh/MeshManager';
import { T } from '@/mesh/protocol';
import { SyncEngine } from '@/sync/SyncEngine';

export const SOS_CATEGORIES = [
    ['medical', 'Medical'], ['security', 'Security threat'], ['fire', 'Fire'],
    ['harassment', 'Harassment / assault'], ['accident', 'Accident'], ['other', 'Other'],
] as const;

export type RaiseResult = { clientId: string; server: 'sent' | 'queued'; mesh: number; location: boolean; coords: { lat: number | null; lng: number | null } };

/**
 * SOS goes out on EVERY channel at once, online or not:
 *   1. server (if reachable) — responders' phones and the web console ring immediately;
 *   2. the mesh — every nearby member (and any phone that can carry it) gets it over Bluetooth / Wi-Fi;
 *      the first phone with internet uploads it, so it reaches the server even from a dead zone;
 *   3. the outbox — retried automatically until the server confirms.
 * GPS works without data, so the location is attached even fully offline (if the member allowed it).
 */
export async function raiseSos(category: string, label: string | null, shareLocation: boolean): Promise<RaiseResult> {
    const id = await loadIdentity();
    if (!id) throw new Error('Not signed in');
    const clientId = Crypto.randomUUID();

    let coords: Location.LocationObjectCoords | null = null;
    if (shareLocation) {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
            coords = (await Location.getLastKnownPositionAsync({ maxAge: 120_000 }))?.coords ?? null;
            const fresh = await Promise.race([
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then((p) => p.coords).catch(() => null),
                new Promise<null>((r) => setTimeout(() => r(null), 6000)),
            ]);
            coords = fresh ?? coords;
        }
    }

    const payload = {
        client_id: clientId, category, location_label: label || null,
        lat: coords?.latitude ?? null, lng: coords?.longitude ?? null, accuracy_m: coords?.accuracy ? Math.round(coords.accuracy) : null,
        raised_at: new Date().toISOString(),
    };

    const d = await db();
    await d.runAsync(
        `INSERT INTO sos (client_id, owner_id, owner_name, category, json, status, raised_at, mine, source) VALUES (?, ?, ?, ?, ?, 'open', ?, 1, 'me')`,
        clientId, id.userId, id.name, category, JSON.stringify(payload), payload.raised_at);
    await d.runAsync('INSERT OR REPLACE INTO outbox (client_id, kind, payload, created_at) VALUES (?, ?, ?, 0)', clientId, 'sos', JSON.stringify(payload));
    emit('sos', undefined);

    // Mesh first: it costs nothing and reaches people physically nearby fastest.
    let mesh = 0;
    try {
        await MeshManager.publish(T.SOS, `i:${id.institutionId}`, payload);
        mesh = MeshManager.peerList.length;
    } catch { /* no mesh available */ }

    let server: RaiseResult['server'] = 'queued';
    if (SyncEngine.online) {
        try {
            const r = await api<{ alert: { uuid: string } }>('/sos', { body: payload, timeoutMs: 10000 });
            await d.runAsync('UPDATE sos SET uuid = ? WHERE client_id = ?', r.alert.uuid, clientId);
            await d.runAsync('DELETE FROM outbox WHERE client_id = ?', clientId);
            server = 'sent';
        } catch { /* stays in outbox */ }
    }
    emit('sos', undefined);
    return { clientId, server, mesh, location: !!coords, coords: { lat: payload.lat, lng: payload.lng } };
}

export async function updateSos(clientId: string, uuid: string | null, ownerId: number, action: string, note?: string) {
    const id = await loadIdentity();
    if (!id) return;
    const payload = { alert_uuid: uuid, alert_client_id: clientId, owner_id: ownerId, action, note: note ?? null };
    const d = await db();
    await d.runAsync('UPDATE sos SET status = ? WHERE client_id = ?', action === 'cancelled' || action === 'resolved' ? action : 'responding', clientId);
    emit('sos', undefined);
    await MeshManager.publish(T.SOS_UPDATE, `i:${id.institutionId}`, payload).catch(() => null);
    if (uuid) {
        await d.runAsync('INSERT OR REPLACE INTO outbox (client_id, kind, payload, created_at) VALUES (?, ?, ?, ?)', Crypto.randomUUID(), 'sos_updates', JSON.stringify(payload), Date.now());
        SyncEngine.run();
    }
}

/** No data at all? An ordinary SMS still works on most networks. Opens the SMS app pre-filled; the user presses send. */
export async function smsFallback(securityPhone: string, category: string, label: string | null, coords: { lat: number | null; lng: number | null }) {
    if (!(await SMS.isAvailableAsync())) return false;
    const where = coords.lat !== null ? ` Location: https://maps.google.com/?q=${coords.lat},${coords.lng}` : '';
    await SMS.sendSMSAsync([securityPhone], `SOS (${category}). ${label ?? ''}${where} — sent from SOS Connect`);
    return true;
}
