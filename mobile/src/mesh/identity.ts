import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { config } from '@/config';
import { deviceKeys } from '@/crypto/keys';
import { api } from '@/lib/api';
import { fromBase64, toBase64 } from '@/lib/base64';
import type { Certificate } from './protocol';

/**
 * What the phone needs to take part in the mesh while offline: its platform-signed certificate,
 * the institution's mesh keys, and the platform public key used to check other phones.
 * Refreshed on every login and whenever the certificate is within 7 days of expiry.
 */
export type MeshIdentity = {
    userId: number;
    name: string;
    institutionId: number;
    deviceId: number;
    certificate: Certificate;
    platformPublicKey: string;
    meshKeys: Record<string, string>; // kid -> base64 key
    currentKid: string;
    allowForeignRelay: boolean;
};

const KEY = 'sos.mesh.identity.v1';
let cached: MeshIdentity | null = null;

export async function loadIdentity(): Promise<MeshIdentity | null> {
    if (cached) return cached;
    const raw = await SecureStore.getItemAsync(KEY);
    cached = raw ? JSON.parse(raw) : null;
    return cached;
}

async function save(id: MeshIdentity) {
    cached = id;
    await SecureStore.setItemAsync(KEY, JSON.stringify(id), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function clearIdentity() {
    cached = null;
    await SecureStore.deleteItemAsync(KEY);
}

type RegisterResponse = {
    device_id: number;
    certificate: Certificate;
    platform_public_key: string;
    mesh_keys: { kid: string; key: string; current: boolean }[];
    allow_foreign_relay: boolean;
};

export async function registerDevice(pushToken: string | null): Promise<MeshIdentity> {
    const keys = await deviceKeys();
    const r = await api<RegisterResponse>('/devices', { body: {
        device_uid: keys.deviceUid,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        sign_public_key: toBase64(keys.sign.publicKey),
        box_public_key: toBase64(keys.box.publicKey),
        push_token: pushToken,
    } });

    // The key pinned in the app wins: a compromised server response can't swap the trust anchor.
    const platformPublicKey = config.platformPublicKey || r.platform_public_key;
    const identity: MeshIdentity = {
        userId: r.certificate.uid,
        name: r.certificate.name,
        institutionId: r.certificate.iid,
        deviceId: r.device_id,
        certificate: r.certificate,
        platformPublicKey,
        meshKeys: Object.fromEntries(r.mesh_keys.map((k) => [k.kid, k.key])),
        currentKid: r.mesh_keys.find((k) => k.current)?.kid ?? r.mesh_keys[0]?.kid ?? '',
        allowForeignRelay: r.allow_foreign_relay,
    };
    await save(identity);
    return identity;
}

export async function updateMeshKeys(list: { kid: string; key: string; current: boolean }[]) {
    const id = await loadIdentity();
    if (!id || !list.length) return;
    await save({ ...id, meshKeys: Object.fromEntries(list.map((k) => [k.kid, k.key])), currentKid: list.find((k) => k.current)?.kid ?? id.currentKid });
}

export function certificateNeedsRenewal(id: MeshIdentity) {
    return id.certificate.exp * 1000 - Date.now() < 7 * 86400_000;
}

export function meshKeyBytes(id: MeshIdentity): Record<string, Uint8Array> {
    return Object.fromEntries(Object.entries(id.meshKeys).map(([k, v]) => [k, fromBase64(v)]));
}
