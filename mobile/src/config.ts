import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<{
    apiUrl: string;
    reverb: { key: string; host: string; port: number; scheme: string };
    platformPublicKey: string;
}>;

export const config = {
    apiUrl: (extra.apiUrl ?? '').replace(/\/$/, ''),
    reverb: extra.reverb ?? { key: '', host: '', port: 443, scheme: 'https' },
    platformPublicKey: extra.platformPublicKey ?? '',
    mesh: {
        serviceId: 'ng.sosconnect.mesh',
        udpPort: 47321,
        tcpPort: 47322,
        maxEnvelopeBytes: 30 * 1024,     // Bluetooth-friendly; media never travels over the mesh
        defaultTtlHops: 8,
        sosTtlHops: 16,
        messageLifetimeMs: 48 * 3600_000,
        sosLifetimeMs: 72 * 3600_000,
        inventoryLimit: 300,
    },
};
