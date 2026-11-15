import { decode, encode } from '@msgpack/msgpack';
import nacl from 'tweetnacl';
import { fromBase64, hex, toBase64, utf8 } from '@/lib/base64';

/**
 * Envelope format — must stay byte-for-byte compatible with app/Services/Mesh/Envelope.php and
 * PlatformSigner.php on the server and with edge-node/src/protocol.mjs.
 */
export const T = { MESSAGE: 1, SOS: 2, SOS_UPDATE: 3, SAFETY_RESPONSE: 4, READ_RECEIPT: 5, CALL_SIGNAL: 6, ANNOUNCEMENT: 7 } as const;

export type Certificate = { v: 1; cid: string; uid: number; iid: number; did: number; spk: string; bpk: string; role: string; name: string; exp: number; sig: string };

export type Envelope = {
    v: 1;
    id: string;          // 32 hex
    iid: number;
    t: number;
    to: string;          // c:<id> | u:<id> | i:<id>
    ts: number;          // ms
    exp: number;         // ms
    hop: number;         // not signed
    enc: 'k' | 'b';
    kid: string;
    n: string;           // base64 nonce
    ct: string;          // base64 ciphertext
    cert: Certificate;
    sig: string;
};

export const canonicalCert = (c: Certificate) =>
    ['SOSCERTv1', c.cid, c.uid, c.iid, c.did, c.spk, c.bpk, c.role, c.name, c.exp].join('\n');

export const canonical = (e: Omit<Envelope, 'sig' | 'hop' | 'cert' | 'v'>) =>
    ['SOSv1', e.id, e.iid, e.t, e.to, e.ts, e.exp, e.enc, e.kid, e.n, e.ct].join('\n');

export function verifyCertificate(cert: Certificate, platformPublicKey: string, graceSeconds = 7 * 86400): boolean {
    try {
        if (cert.exp + graceSeconds < Date.now() / 1000) return false;
        return nacl.sign.detached.verify(utf8.encode(canonicalCert(cert)), fromBase64(cert.sig), fromBase64(platformPublicKey));
    } catch {
        return false;
    }
}

export function verifyEnvelope(e: Envelope, platformPublicKey: string): { ok: true } | { ok: false; reason: string } {
    if (!/^[0-9a-f]{32}$/.test(e.id) || !/^[cui]:\d{1,20}$/.test(e.to)) return { ok: false, reason: 'shape' };
    if (e.exp < Date.now()) return { ok: false, reason: 'expired' };
    if (!verifyCertificate(e.cert, platformPublicKey)) return { ok: false, reason: 'certificate' };
    if (e.cert.iid !== e.iid) return { ok: false, reason: 'institution' };
    try {
        const good = nacl.sign.detached.verify(utf8.encode(canonical(e)), fromBase64(e.sig), fromBase64(e.cert.spk));
        return good ? { ok: true } : { ok: false, reason: 'signature' };
    } catch {
        return { ok: false, reason: 'signature' };
    }
}

type SealArgs = {
    cert: Certificate;
    signSecretKey: Uint8Array;
    type: number;
    to: string;
    payload: unknown;
    lifetimeMs: number;
    hops: number;
} & ({ enc: 'k'; keyId: string; key: Uint8Array } | { enc: 'b'; recipientDeviceId: number; recipientBoxKey: Uint8Array; boxSecretKey: Uint8Array });

export function seal(a: SealArgs): Envelope {
    const nonce = nacl.randomBytes(24);
    const plain = utf8.encode(JSON.stringify(a.payload));
    const ct = a.enc === 'k' ? nacl.secretbox(plain, nonce, a.key) : nacl.box(plain, nonce, a.recipientBoxKey, a.boxSecretKey);
    const now = Date.now();
    const body = {
        id: hex(nacl.randomBytes(16)), iid: a.cert.iid, t: a.type, to: a.to, ts: now, exp: now + a.lifetimeMs,
        enc: a.enc, kid: a.enc === 'k' ? a.keyId : String(a.recipientDeviceId), n: toBase64(nonce), ct: toBase64(ct),
    } as const;
    const sig = nacl.sign.detached(utf8.encode(canonical(body)), a.signSecretKey);
    return { v: 1, ...body, hop: a.hops, cert: a.cert, sig: toBase64(sig) };
}

/** Opens an envelope addressed to this phone's institution key, or sealed to this device. */
export function open(e: Envelope, keys: { meshKeys: Record<string, Uint8Array>; deviceId: number | null; boxSecretKey: Uint8Array }): unknown | null {
    const nonce = fromBase64(e.n);
    const ct = fromBase64(e.ct);
    let plain: Uint8Array | null = null;
    if (e.enc === 'k' && keys.meshKeys[e.kid]) {
        plain = nacl.secretbox.open(ct, nonce, keys.meshKeys[e.kid]);
    } else if (e.enc === 'b' && keys.deviceId !== null && e.kid === String(keys.deviceId)) {
        plain = nacl.box.open(ct, nonce, fromBase64(e.cert.bpk), keys.boxSecretKey);
    }
    if (!plain) return null;
    try {
        return JSON.parse(utf8.decode(plain));
    } catch {
        return null;
    }
}

/* ---- Wire frames between peers (Bluetooth / Wi-Fi Direct / LAN). MessagePack keeps them small. ---- */

export type Frame =
    | { k: 'hello'; uid: number; iid: number; did: number; name: string }
    | { k: 'inv'; ids: string[] }            // what I carry (16-hex prefixes)
    | { k: 'want'; ids: string[] }           // what I'm missing
    | { k: 'env'; e: Envelope }
    | { k: 'call'; to: number; from: number; data: unknown }; // LAN call signalling (same Wi-Fi only)

export const encodeFrame = (f: Frame): Uint8Array => encode(f);
export const decodeFrame = (b: Uint8Array): Frame | null => {
    try {
        const f = decode(b) as Frame;
        return f && typeof f === 'object' && 'k' in f ? f : null;
    } catch {
        return null;
    }
};
export const shortId = (id: string) => id.slice(0, 16);
