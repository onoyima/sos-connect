const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);
for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
        out += chars[a >> 2] + chars[((a & 3) << 4) | ((b ?? 0) >> 4)]
            + (b === undefined ? '=' : chars[((b & 15) << 2) | ((c ?? 0) >> 6)])
            + (c === undefined ? '=' : chars[c & 63]);
    }
    return out;
}

export function fromBase64(s: string): Uint8Array {
    const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let p = 0;
    for (let i = 0; i < clean.length; i += 4) {
        const a = lookup[clean.charCodeAt(i)], b = lookup[clean.charCodeAt(i + 1)];
        const c = lookup[clean.charCodeAt(i + 2)], d = lookup[clean.charCodeAt(i + 3)];
        out[p++] = (a << 2) | (b >> 4);
        if (i + 2 < clean.length) out[p++] = ((b & 15) << 4) | (c >> 2);
        if (i + 3 < clean.length) out[p++] = ((c & 3) << 6) | d;
    }
    return out.slice(0, p);
}

/** UTF-8 without relying on TextEncoder/TextDecoder (not present on every Hermes version). */
export const utf8 = {
    encode(s: string): Uint8Array {
        const out: number[] = [];
        for (const ch of s) {
            let c = ch.codePointAt(0)!;
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
        }
        return new Uint8Array(out);
    },
    decode(b: Uint8Array): string {
        let s = '';
        for (let i = 0; i < b.length;) {
            const x = b[i++];
            let c: number;
            if (x < 0x80) c = x;
            else if (x < 0xe0) c = ((x & 31) << 6) | (b[i++] & 63);
            else if (x < 0xf0) c = ((x & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            else c = ((x & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            s += String.fromCodePoint(c);
        }
        return s;
    },
};

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
