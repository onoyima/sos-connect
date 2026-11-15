import { useFocusEffect } from 'expo-router';
import { MeshNearby } from 'mesh-nearby';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';
import { db, kvGet, kvSet } from '@/db/database';
import { on } from '@/lib/events';
import { MeshManager } from '@/mesh/MeshManager';
import { SyncEngine } from '@/sync/SyncEngine';
import { BackBar } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/** Shows how the phone is connected right now and lets the member help relay alerts in the background. */
export default function Nearby() {
    const [peers, setPeers] = useState(MeshManager.peerList);
    const [online, setOnline] = useState(SyncEngine.online);
    const [carried, setCarried] = useState({ total: 0, sos: 0, waiting: 0 });
    const [background, setBackground] = useState(false);

    const refresh = useCallback(async () => {
        setPeers(MeshManager.peerList);
        const d = await db();
        const r = await d.getFirstAsync<{ total: number; sos: number; waiting: number }>(
            'SELECT count(*) AS total, sum(CASE WHEN t = 2 THEN 1 ELSE 0 END) AS sos, sum(CASE WHEN uploaded = 0 THEN 1 ELSE 0 END) AS waiting FROM envelopes WHERE exp > ?', Date.now());
        setCarried({ total: r?.total ?? 0, sos: r?.sos ?? 0, waiting: r?.waiting ?? 0 });
    }, []);

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
    useEffect(() => {
        kvGet<boolean>('pref.background').then((v) => setBackground(!!v));
        const a = on('peers', refresh);
        const b = on('online', (v) => { setOnline(v); refresh(); });
        return () => { a(); b(); };
    }, [refresh]);

    const toggleBackground = async (v: boolean) => {
        setBackground(v);
        await kvSet('pref.background', v);
        MeshNearby.setBackground(v, 'SOS Connect', 'Helping relay emergency alerts for people nearby');
    };

    return (
        <View style={ui.screen}>
        <BackBar title="Offline and nearby" subtitle={online ? 'Internet connected' : 'No internet'} />
        <ScrollView contentContainerStyle={ui.pad}>
            <View style={ui.card}>
                <Text style={ui.h2}>Connections</Text>
                <Text style={ui.text}>Internet: <Text style={{ color: online ? colors.ok : colors.warn }}>{online ? 'connected' : 'none'}</Text></Text>
                <Text style={ui.text}>Bluetooth / Wi-Fi Direct: {MeshNearby.available() ? 'on' : 'not available on this build'}</Text>
                <Text style={ui.text}>Same Wi-Fi (access point / hotspot): listening</Text>
            </View>
            <View style={ui.card}>
                <Text style={ui.h2}>People and relays nearby ({peers.length})</Text>
                {peers.length === 0 && <Text style={ui.small}>No one in range yet. Phones connect automatically when within about 30–100 m, or on the same Wi-Fi.</Text>}
                {peers.map((p) => (
                    <Text key={p.id} style={ui.text}>{p.name} · {p.via === 'lan' ? 'Wi-Fi' : 'Bluetooth/Wi-Fi Direct'}{p.sameInstitution ? '' : ' · other institution (relay only)'}</Text>
                ))}
            </View>
            <View style={ui.card}>
                <Text style={ui.h2}>Carrying for others</Text>
                <Text style={ui.text}>{carried.total} encrypted item(s), {carried.sos} SOS. {carried.waiting} waiting to be uploaded when any internet appears.</Text>
                <Text style={ui.small}>You can't read other people's items. They expire automatically (messages after 2 days, SOS after 3).</Text>
            </View>
            {Platform.OS === 'android' && (
                <View style={[ui.card, ui.row, { justifyContent: 'space-between' }]}>
                    <Text style={[ui.text, { flex: 1 }]}>Keep relaying alerts when the app is closed (shows a notification, uses a little battery)</Text>
                    <Switch value={background} onValueChange={toggleBackground} />
                </View>
            )}
            {Platform.OS === 'ios' && <Text style={ui.small}>iPhones relay while SOS Connect is open. Keep it open during an emergency to help others.</Text>}
        </ScrollView>
        </View>
    );
}
