import nacl from 'tweetnacl';

// Same canonical strings as app/Services/Mesh/*.php and mobile/src/mesh/protocol.ts
export const canonicalCert = (c) => ['SOSCERTv1', c.cid, c.uid, c.iid, c.did, c.spk, c.bpk, c.role, c.name, c.exp].join('\n');
export const canonical = (e) => ['SOSv1', e.id, e.iid, e.t, e.to, e.ts, e.exp, e.enc, e.kid, e.n, e.ct].join('\n');

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

export function verifyEnvelope(e, platformPublicKey) {
    try {
        if (!/^[0-9a-f]{32}$/.test(e.id) || !/^[cui]:\d{1,20}$/.test(e.to)) return false;
        if (e.exp < Date.now() || e.cert.iid !== e.iid) return false;
        if (e.cert.exp + 7 * 86400 < Date.now() / 1000) return false;
        if (!nacl.sign.detached.verify(utf8(canonicalCert(e.cert)), b64(e.cert.sig), b64(platformPublicKey))) return false;
        return nacl.sign.detached.verify(utf8(canonical(e)), b64(e.sig), b64(e.cert.spk));
    } catch {
        return false;
    }
}
