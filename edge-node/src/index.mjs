import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs';
import { decode, encode } from '@msgpack/msgpack';
import { verifyEnvelope } from './protocol.mjs';

/**
 * SOS Connect edge node. Plug into any campus access point (or run on a laptop sharing a hotspot):
 *  - phones on this Wi-Fi discover it by UDP beacon and connect over TCP, exactly like phone-to-phone;
 *  - it checks every envelope's signature, keeps it until expiry and hands it to every phone it meets,
 *    so messages hop between hostels/buildings even with the internet down;
 *  - whenever it has internet it uploads everything to the server (and phones nearby benefit).
 * It cannot read any message: it holds no institution keys.
 */
const env = Object.fromEntries((fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = {
    platformPk: process.env.PLATFORM_PUBLIC_KEY ?? env.PLATFORM_PUBLIC_KEY,
    apiUrl: (process.env.API_URL ?? env.API_URL ?? '').replace(/\/$/, ''),
    apiToken: process.env.API_TOKEN ?? env.API_TOKEN,
    name: process.env.NODE_NAME ?? env.NODE_NAME ?? 'edge',
    dataFile: process.env.DATA_FILE ?? env.DATA_FILE ?? './edge-store.json',
    udpPort: 47321, tcpPort: 47322, maxFrame: 64 * 1024, maxStored: 20000,
};
if (!cfg.platformPk) { console.error('PLATFORM_PUBLIC_KEY is required'); process.exit(1); }

const PRIORITY = { 2: 9, 3: 8, 4: 7, 7: 6, 1: 3, 5: 1 };
const store = new Map(fs.existsSync(cfg.dataFile) ? JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')) : []); // id -> { e, uploaded }
const peers = new Map();
const tag = `e${Math.random().toString(36).slice(2, 10)}`;

function persist() {
    for (const [id, v] of store) if (v.e.exp < Date.now()) store.delete(id);
    if (store.size > cfg.maxStored) [...store.entries()].sort((a, b) => (PRIORITY[a[1].e.t] ?? 0) - (PRIORITY[b[1].e.t] ?? 0)).slice(0, store.size - cfg.maxStored).forEach(([id]) => store.delete(id));
    fs.writeFileSync(cfg.dataFile, JSON.stringify([...store]));
}
setInterval(persist, 60_000);

function send(socket, frame) {
    const body = Buffer.from(encode(frame));
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    socket.write(Buffer.concat([head, body]));
}

function inventory(socket) {
    const ids = [...store.values()].filter((v) => v.e.exp > Date.now() && v.e.hop > 0)
        .sort((a, b) => (PRIORITY[b.e.t] ?? 0) - (PRIORITY[a.e.t] ?? 0)).slice(0, 300).map((v) => v.e.id.slice(0, 16));
    if (ids.length) send(socket, { k: 'inv', ids });
}

function accept(e, fromId) {
    if (!e?.id || store.has(e.id) || !verifyEnvelope(e, cfg.platformPk) || e.t === 6) return;
    store.set(e.id, { e, uploaded: false });
    console.log(`[edge] stored ${e.t === 2 ? 'SOS' : 'envelope'} ${e.id.slice(0, 8)} from institution ${e.iid}`);
    if (e.hop > 0) for (const [id, s] of peers) if (id !== fromId) send(s, { k: 'env', e: { ...e, hop: e.hop - 1 } });
}

function adopt(socket, id) {
    if (peers.has(id)) return socket.destroy();
    peers.set(id, socket);
    send(socket, { k: 'hello', uid: 0, iid: 0, did: 0, name: cfg.name });
    inventory(socket);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
            const len = buf.readUInt32BE(0);
            if (len > cfg.maxFrame) return socket.destroy();
            if (buf.length < 4 + len) break;
            let f; try { f = decode(buf.subarray(4, 4 + len)); } catch { f = null; }
            buf = buf.subarray(4 + len);
            if (!f) continue;
            if (f.k === 'env') accept(f.e, id);
            else if (f.k === 'inv') {
                const want = f.ids.filter((x) => ![...store.keys()].some((k) => k.startsWith(x))).slice(0, 300);
                if (want.length) send(socket, { k: 'want', ids: want });
            } else if (f.k === 'want') {
                for (const v of store.values()) if (f.ids.includes(v.e.id.slice(0, 16)) && v.e.hop > 0) send(socket, { k: 'env', e: { ...v.e, hop: v.e.hop - 1 } });
            }
        }
    });
    const gone = () => peers.delete(id);
    socket.on('close', gone);
    socket.on('error', gone);
}

net.createServer((s) => adopt(s, `lan:${s.remoteAddress}`)).listen(cfg.tcpPort, '0.0.0.0');

const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udp.bind(cfg.udpPort, () => udp.setBroadcast(true));
udp.on('message', (msg, rinfo) => {
    try {
        const b = decode(msg);
        if (b?.k === 'beacon' && b.tag !== tag && !peers.has(`lan:${rinfo.address}`) && tag < b.tag) {
            const s = net.connect(b.port, rinfo.address, () => adopt(s, `lan:${rinfo.address}`));
            s.on('error', () => s.destroy());
        }
    } catch { /* not ours */ }
});
const beacon = Buffer.from(encode({ k: 'beacon', tag, port: cfg.tcpPort }));
setInterval(() => udp.send(beacon, cfg.udpPort, '255.255.255.255'), 5000);
setInterval(() => peers.forEach((s) => inventory(s)), 30_000);

// Gateway: upload whenever internet is available.
async function upload() {
    if (!cfg.apiUrl || !cfg.apiToken) return;
    const batch = [...store.values()].filter((v) => !v.uploaded && v.e.exp > Date.now()).sort((a, b) => (PRIORITY[b.e.t] ?? 0) - (PRIORITY[a.e.t] ?? 0)).slice(0, 200);
    if (!batch.length) return;
    try {
        const res = await fetch(`${cfg.apiUrl}/api/mesh/relay`, {
            method: 'POST', signal: AbortSignal.timeout(20000),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${cfg.apiToken}` },
            body: JSON.stringify({ envelopes: batch.map((v) => v.e) }),
        });
        if (!res.ok) return;
        const { results } = await res.json();
        for (const id of Object.keys(results)) { const v = store.get(id); if (v) v.uploaded = true; }
        console.log(`[edge] uploaded ${Object.keys(results).length}`);
    } catch { /* offline — try again later */ }
}
setInterval(upload, 15_000);

console.log(`[edge] ${cfg.name} relaying on UDP ${cfg.udpPort} / TCP ${cfg.tcpPort}; ${store.size} stored`);
process.on('SIGINT', () => { persist(); process.exit(0); });
process.on('SIGTERM', () => { persist(); process.exit(0); });
