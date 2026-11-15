import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { BackBar, Button, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type WebSession = { since: string | null; via: 'password' | 'qr' | null; browser: string; ip: string | null } | null;

/**
 * The phone is the main device (like WhatsApp): it links one web browser by scanning the QR code on the
 * website's sign-in page, and can sign that browser out. Admin accounts sign in on the website with a password.
 */
export default function LinkedDevices() {
    const [web, setWeb] = useState<WebSession>(null);
    const [canLink, setCanLink] = useState(true);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [permission, requestPermission] = useCameraPermissions();
    const busy = useRef(false);

    const load = useCallback(async () => {
        try {
            const r = await api<{ web: WebSession; can_link: boolean }>('/linked-devices');
            setWeb(r.web);
            setCanLink(r.can_link);
        } catch (e) { Alert.alert('Needs internet', (e as Error).message); }
        setLoading(false);
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const startScan = async () => {
        if (!permission?.granted) {
            const p = await requestPermission();
            if (!p.granted) { Alert.alert('Camera needed', 'Allow the camera to scan the code on the computer screen.'); return; }
        }
        busy.current = false;
        setScanning(true);
    };

    const scanned = async (data: string) => {
        if (busy.current) return;
        if (!data.startsWith('sos-link:')) return; // some other QR code: keep looking
        busy.current = true;
        try {
            const r = await api<{ browser: string }>('/linked-devices/web', { body: { code: data } });
            setScanning(false);
            Alert.alert('Linked', `${r.browser} is now signed in to your account.${web ? ' The browser that was signed in before has been signed out.' : ''}`);
            load();
        } catch (e) {
            setScanning(false);
            Alert.alert('Not linked', (e as Error).message);
        }
    };

    const signOutWeb = () => Alert.alert('Sign out the web browser?', `${web?.browser ?? 'The browser'} will be signed out straight away.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => {
            try { await api('/linked-devices/web', { method: 'DELETE' }); setWeb(null); } catch (e) { Alert.alert('Needs internet', (e as Error).message); }
        } },
    ]);

    if (scanning) {
        return (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
                <BackBar title="Scan the code" subtitle="On the computer, open the sign-in page and choose Link with phone" />
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={({ data }) => { scanned(data); }} />
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: '#fff' }} />
                </View>
                <View style={{ padding: 20, backgroundColor: '#000' }}>
                    <Button title="Cancel" variant="outline" onPress={() => setScanning(false)} />
                </View>
            </View>
        );
    }

    const since = web?.since ? new Date(web.since) : null;

    return (
        <View style={ui.screen}>
            <BackBar title="Linked devices" />
            <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
                <View style={{ alignItems: 'center', padding: 24, gap: 10, backgroundColor: '#fff' }}>
                    <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="desktop-outline" size={40} color={colors.grove} />
                    </View>
                    <Text style={[ui.text, { textAlign: 'center' }]}>
                        Use SOS Connect on a computer. Your account can be open on this phone and one web browser at the same time.
                    </Text>
                    {canLink
                        ? <Button title="Link a web browser" icon="qr-code-outline" onPress={startScan} style={{ alignSelf: 'stretch' }} />
                        : <Text style={[ui.small, { textAlign: 'center' }]}>Admin accounts sign in to the website with their password instead of linking a phone.</Text>}
                </View>

                <Text style={ui.sectionTitle}>Web browser</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    {loading ? <ActivityIndicator style={{ padding: 20 }} color={colors.leaf} />
                        : web ? (
                            <Pressable onPress={signOutWeb} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
                                <Icon name="laptop-outline" size={28} color={colors.muted} />
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>{web.browser}</Text>
                                    <Text style={ui.small}>
                                        {web.via === 'qr' ? 'Linked from this phone' : 'Signed in with password'}
                                        {since ? ` · since ${since.toLocaleDateString()} ${since.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                                    </Text>
                                    <Text style={{ color: colors.sos, fontWeight: '600', marginTop: 4 }}>Sign out</Text>
                                </View>
                            </Pressable>
                        ) : <Text style={[ui.small, { padding: 16 }]}>No web browser is signed in.</Text>}
                </View>
                <Text style={[ui.small, { padding: 16 }]}>
                    A browser linked from this phone is signed out if you sign out here or sign in on a different phone.
                </Text>
            </ScrollView>
        </View>
    );
}
