import dgram from 'react-native-udp';
import TcpSocket from 'react-native-tcp-socket';
import { encode, decode } from '@msgpack/msgpack';
import { config } from '@/config';

/**
 * Wi-Fi access-point transport. Phones (and edge nodes) on the same Wi-Fi find each other with a UDP
 * broadcast beacon and talk over TCP — no internet needed, only the router/hotspot. This is also how
 * Android and iPhones reach each other, and how calls work on a campus Wi-Fi that has lost its uplink.
 *
 * Framing on TCP: 4-byte big-endian length + MessagePack frame.
 */
export type LanPeer = { id: string; host: string; send: (bytes: Uint8Array) => Promise<void>; close: () => void };

type Handlers = {
    onPeer: (p: LanPeer) => void;
    onPeerLost: (id: string) => void;
    onData: (id: string, bytes: Uint8Array) => void;
};

export class LanTransport {
    private udp: ReturnType<typeof dgram.createSocket> | null = null;
    private server: ReturnType<typeof TcpSocket.createServer> | null = null;
    private beaconTimer: ReturnType<typeof setInterval> | null = null;
    private peers = new Map<string, LanPeer>();
    private myTag = '';

    constructor(private h: Handlers) {}

    start(tag: string) {
        this.myTag = tag; // e.g. "d123" — used only to decide which side dials
        this.server = TcpSocket.createServer((socket) => this.adopt(socket, `${socket.remoteAddress}`));
        this.server.listen({ port: config.mesh.tcpPort, host: '0.0.0.0', reuseAddress: true });

        this.udp = dgram.createSocket({ type: 'udp4', reusePort: true });
        this.udp.bind(config.mesh.udpPort, () => {
            try { this.udp?.setBroadcast(true); } catch { /* some networks forbid broadcast */ }
        });
        this.udp.on('message', (msg: Uint8Array, rinfo: { address: string }) => {
            try {
                const b = decode(msg) as { k: string; tag: string; port: number };
                if (b?.k !== 'beacon' || b.tag === this.myTag || this.peers.has(rinfo.address)) return;
                if (this.myTag < b.tag) this.dial(rinfo.address, b.port);
            } catch { /* not ours */ }
        });
        const beacon = encode({ k: 'beacon', tag: this.myTag, port: config.mesh.tcpPort });
        this.beaconTimer = setInterval(() => {
            this.udp?.send(beacon, 0, beacon.length, config.mesh.udpPort, '255.255.255.255', () => {});
        }, 5000);
    }

    stop() {
        if (this.beaconTimer) clearInterval(this.beaconTimer);
        this.peers.forEach((p) => p.close());
        this.peers.clear();
        try { this.udp?.close(); } catch { /* closed */ }
        try { this.server?.close(); } catch { /* closed */ }
        this.udp = null;
        this.server = null;
    }

    private dial(host: string, port: number) {
        const socket = TcpSocket.createConnection({ host, port }, () => this.adopt(socket, host));
        socket.on('error', () => socket.destroy());
    }

    private adopt(socket: ReturnType<typeof TcpSocket.createConnection>, host: string) {
        const id = `lan:${host}`;
        if (this.peers.has(id)) { socket.destroy(); return; }
        let buffer = new Uint8Array(0);

        const peer: LanPeer = {
            id, host,
            send: (bytes) => new Promise((resolve) => {
                const framed = new Uint8Array(4 + bytes.length);
                new DataView(framed.buffer).setUint32(0, bytes.length);
                framed.set(bytes, 4);
                socket.write(framed as unknown as string, undefined, () => resolve());
            }),
            close: () => socket.destroy(),
        };
        this.peers.set(id, peer);
        this.h.onPeer(peer);

        socket.on('data', (chunk: unknown) => {
            const data = typeof chunk === 'string' ? new Uint8Array() : new Uint8Array(chunk as ArrayBuffer);
            const merged = new Uint8Array(buffer.length + data.length);
            merged.set(buffer); merged.set(data, buffer.length);
            buffer = merged;
            while (buffer.length >= 4) {
                const len = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0);
                if (len > config.mesh.maxEnvelopeBytes * 2) { socket.destroy(); return; }
                if (buffer.length < 4 + len) break;
                this.h.onData(id, buffer.slice(4, 4 + len));
                buffer = buffer.slice(4 + len);
            }
        });
        const gone = () => { if (this.peers.delete(id)) this.h.onPeerLost(id); };
        socket.on('close', gone);
        socket.on('error', gone);
    }
}
