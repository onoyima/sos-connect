import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { config } from '@/config';
import { kvSet } from '@/db/database';
import { api } from '@/lib/api';
import { Button } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

const VERSION = '2026-11-09';

export default function Policies() {
    const { me, refreshMe, logout } = useAuth();
    const [sosLocation, setSosLocation] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const link = (slug: string) => () => Linking.openURL(`${config.apiUrl}/legal/${slug}`);

    const accept = async () => {
        setBusy(true);
        setError(null);
        try {
            if (sosLocation) await Location.requestForegroundPermissionsAsync();
            await api('/me/accept-policies', { body: { version: VERSION, sos_location: sosLocation } });
            await kvSet('pref.sosLocation', sosLocation);
            await refreshMe();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { paddingTop: 70 }]}>
            <Text style={ui.h1}>Before you start</Text>
            <Text style={ui.small}>Please read this once. It explains what is stored and how SOS works.</Text>
            <View style={ui.card}>
                <Text style={ui.text}>SOS Connect is provided to you by {me?.institution?.name ?? 'your institution'}. We store your name, role, department and what you send, so you can chat and call for help. Your password stays with your institution.</Text>
                <Text style={ui.text}>When you have no internet, your phone passes encrypted messages and SOS alerts to nearby phones over Bluetooth and Wi-Fi, and carries other people's encrypted alerts too. Other phones can't read what isn't meant for them.</Text>
                <Text style={[ui.text, { fontWeight: '700' }]}>SOS is not a replacement for emergency services. Alerts sent without internet may be delayed or not delivered. If you can, also call {me?.institution?.emergency_numbers?.join(' / ') ?? '112'}.</Text>
            </View>
            {me?.needs_guardian_consent && (
                <View style={[ui.card, { backgroundColor: colors.amberBg }]}>
                    <Text style={ui.text}>You are under 18. Your institution must confirm your parent or guardian's consent before chat features are enabled. SOS always works.</Text>
                </View>
            )}
            <View style={[ui.card, ui.row, { justifyContent: 'space-between' }]}>
                <Text style={[ui.text, { flex: 1 }]}>Attach my location when I press SOS (only campus responders and members helping nearby see it)</Text>
                <Switch value={sosLocation} onValueChange={setSosLocation} trackColor={{ true: colors.leaf }} />
            </View>
            <View style={[ui.row, { gap: 16 }]}>
                <Pressable onPress={link('terms-of-service')}><Text style={[ui.small, { color: colors.leaf, fontWeight: '600' }]}>Terms</Text></Pressable>
                <Pressable onPress={link('privacy-policy')}><Text style={[ui.small, { color: colors.leaf, fontWeight: '600' }]}>Privacy policy</Text></Pressable>
                <Pressable onPress={link('sos-emergency-notice')}><Text style={[ui.small, { color: colors.leaf, fontWeight: '600' }]}>SOS notice</Text></Pressable>
            </View>
            {error && <Text style={{ color: colors.sos }}>{error}</Text>}
            <Button title="I agree, continue" onPress={accept} busy={busy} />
            <Button title="Sign out" variant="outline" onPress={() => Alert.alert('Sign out?', 'You can sign in again any time.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } },
            ])} />
        </ScrollView>
    );
}
