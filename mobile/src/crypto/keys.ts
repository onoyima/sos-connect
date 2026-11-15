import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { fromBase64, toBase64 } from '@/lib/base64';

// tweetnacl needs a secure random source; React Native has none built in.
nacl.setPRNG((x, n) => {
    const r = Crypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = r[i];
});

export type DeviceKeys = {
    deviceUid: string;
    sign: { publicKey: Uint8Array; secretKey: Uint8Array };  // Ed25519 — proves who sent an envelope
    box: { publicKey: Uint8Array; secretKey: Uint8Array };   // X25519 — opens envelopes sealed to this phone
};

const KEY = 'sos.device.keys.v1';

/** Keys are made on the phone and kept in the OS keystore. Only the public halves ever leave the device. */
export async function deviceKeys(): Promise<DeviceKeys> {
    const saved = await SecureStore.getItemAsync(KEY);
    if (saved) {
        const j = JSON.parse(saved);
        return {
            deviceUid: j.uid,
            sign: { publicKey: fromBase64(j.spk), secretKey: fromBase64(j.ssk) },
            box: { publicKey: fromBase64(j.bpk), secretKey: fromBase64(j.bsk) },
        };
    }
    const sign = nacl.sign.keyPair();
    const box = nacl.box.keyPair();
    const uid = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, JSON.stringify({
        uid, spk: toBase64(sign.publicKey), ssk: toBase64(sign.secretKey), bpk: toBase64(box.publicKey), bsk: toBase64(box.secretKey),
    }), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    return { deviceUid: uid, sign, box };
}

export async function wipeDeviceKeys() {
    await SecureStore.deleteItemAsync(KEY);
}

export { nacl };
