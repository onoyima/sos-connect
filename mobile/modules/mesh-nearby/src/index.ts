import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Phone-to-phone transport without internet.
 *  Android: Google Nearby Connections (P2P_CLUSTER) — picks Bluetooth, BLE, Wi-Fi Direct or hotspot automatically.
 *  iOS:     MultipeerConnectivity — Bluetooth + peer-to-peer Wi-Fi.
 * Android and iOS phones can't use these to reach each other; they meet on a shared Wi-Fi access point
 * through the LAN transport (src/mesh/lan.ts) or through an edge node.
 */
export type PeerEvent = { endpointId: string; name: string };
export type PayloadEvent = { endpointId: string; data: string /* base64 */ };

type Native = {
    start(serviceId: string, localName: string): Promise<void>;
    stop(): void;
    send(endpointId: string, base64: string): Promise<void>;
    setBackground(enabled: boolean, title: string, text: string): void;
    isAvailable(): boolean;
};

const native = requireOptionalNativeModule<Native>('MeshNearby');
const emitter = native ? new EventEmitter(native as never) : null;

export const MeshNearby = {
    available: () => !!native && native.isAvailable(),
    start: (serviceId: string, localName: string) => native?.start(serviceId, localName) ?? Promise.resolve(),
    stop: () => native?.stop(),
    send: (endpointId: string, base64: string) => native?.send(endpointId, base64) ?? Promise.resolve(),
    setBackground: (enabled: boolean, title: string, text: string) => native?.setBackground(enabled, title, text),
    onPeer: (fn: (e: PeerEvent) => void) => (emitter as any)?.addListener('onPeer', fn),
    onPeerLost: (fn: (e: PeerEvent) => void) => (emitter as any)?.addListener('onPeerLost', fn),
    onPayload: (fn: (e: PayloadEvent) => void) => (emitter as any)?.addListener('onPayload', fn),
};
