import nacl from 'tweetnacl';
import { toBase64, utf8 } from '@/lib/base64';
import { canonicalCert, decodeFrame, encodeFrame, open, seal, T, verifyEnvelope, type Certificate } from '@/mesh/protocol';

/** The offline network's envelopes: signed by the sender, certified by the platform, encrypted for the group or one phone. */
describe('mesh protocol', () => {
    const platform = nacl.sign.keyPair();
    const platformPk = toBase64(platform.publicKey);

    const member = (uid: number, did: number) => {
        const sign = nacl.sign.keyPair();
        const box = nacl.box.keyPair();
        const unsigned = { v: 1 as const, cid: `c${uid}`, uid, iid: 3, did, spk: toBase64(sign.publicKey), bpk: toBase64(box.publicKey), role: 'student', name: `User ${uid}`, exp: Math.floor(Date.now() / 1000) + 86400 };
        const cert: Certificate = { ...unsigned, sig: toBase64(nacl.sign.detached(utf8.encode(canonicalCert({ ...unsigned, sig: '' })), platform.secretKey)) };
        return { cert, sign, box };
    };
    const ada = member(1, 11);
    const bayo = member(2, 22);
    const groupKey = nacl.randomBytes(32);

    it('a group message verifies and opens with the institution key', () => {
        const e = seal({ cert: ada.cert, signSecretKey: ada.sign.secretKey, type: T.MESSAGE, to: 'c:7', payload: { body: 'hello' }, lifetimeMs: 60_000, hops: 8, enc: 'k', keyId: 'k1', key: groupKey });
        expect(verifyEnvelope(e, platformPk)).toEqual({ ok: true });
        expect(open(e, { meshKeys: { k1: groupKey }, deviceId: null, boxSecretKey: bayo.box.secretKey })).toEqual({ body: 'hello' });
        expect(open(e, { meshKeys: {}, deviceId: null, boxSecretKey: bayo.box.secretKey })).toBeNull(); // no key, can only carry it
    });

    it('a private message opens only on the recipient phone', () => {
        const e = seal({ cert: ada.cert, signSecretKey: ada.sign.secretKey, type: T.MESSAGE, to: 'u:2', payload: { body: 'just for you' }, lifetimeMs: 60_000, hops: 8,
            enc: 'b', recipientDeviceId: 22, recipientBoxKey: bayo.box.publicKey, boxSecretKey: ada.box.secretKey });
        expect(open(e, { meshKeys: { k1: groupKey }, deviceId: 22, boxSecretKey: bayo.box.secretKey })).toEqual({ body: 'just for you' });
        expect(open(e, { meshKeys: { k1: groupKey }, deviceId: 99, boxSecretKey: nacl.box.keyPair().secretKey })).toBeNull();
    });

    it('rejects tampering, forged certificates and expired envelopes', () => {
        const e = seal({ cert: ada.cert, signSecretKey: ada.sign.secretKey, type: T.SOS, to: 'i:3', payload: { category: 'fire' }, lifetimeMs: 60_000, hops: 16, enc: 'k', keyId: 'k1', key: groupKey });
        expect(verifyEnvelope({ ...e, to: 'i:4' }, platformPk)).toEqual({ ok: false, reason: 'signature' });
        expect(verifyEnvelope({ ...e, cert: { ...e.cert, role: 'security' } }, platformPk)).toEqual({ ok: false, reason: 'certificate' });
        expect(verifyEnvelope({ ...e, exp: Date.now() - 1 }, platformPk).ok).toBe(false);
        expect(verifyEnvelope(e, toBase64(nacl.sign.keyPair().publicKey))).toEqual({ ok: false, reason: 'certificate' });
        expect(verifyEnvelope({ ...e, hop: 1 }, platformPk)).toEqual({ ok: true }); // hop count changes on the way and isn't signed
    });

    it('frames survive encoding and junk is ignored', () => {
        const f = { k: 'inv' as const, ids: ['abc', 'def'] };
        expect(decodeFrame(encodeFrame(f))).toEqual(f);
        expect(decodeFrame(new Uint8Array([1, 2, 3]))).toBeNull();
    });
});
