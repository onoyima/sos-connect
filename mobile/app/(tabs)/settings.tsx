import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { config } from '@/config';
import { kvGet, kvSet } from '@/db/database';
import { api } from '@/lib/api';
import { Avatar, Icon, ListRow, TopBar, type IconName } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

function Row({ icon, title, subtitle, onPress, danger, right }: { icon: IconName; title: string; subtitle?: string | null; onPress?: () => void; danger?: boolean; right?: ReactNode }) {
    return <ListRow title={title} subtitle={subtitle} danger={danger} onPress={onPress} left={<Icon name={icon} color={danger ? colors.sos : colors.muted} />}
        right={right ?? (onPress ? <Icon name="chevron-forward" size={18} color={colors.line} /> : null)} />;
}

/** My profile from the institution's records, my children (parents), offline relaying and privacy. No admin tools here. */
export default function Me() {
    const router = useRouter();
    const { me, has, logout } = useAuth();
    const [sosLocation, setSosLocation] = useState(true);
    useEffect(() => { kvGet<boolean>('pref.sosLocation').then((v) => setSosLocation(v ?? true)); }, []);

    const deleteAccount = () => Alert.alert('Delete your account?',
        "You'll be signed out everywhere and can't sign in again unless your school restores it. Your institution keeps a record of the account and what was sent from it. Your request to erase your data goes to its data protection officer.", [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
            try {
                await api('/privacy/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
                await logout({ local: true }); // already signed out by the server
                Alert.alert('Account closed', "If you want it back, ask your school's ICT unit to restore it.");
            } catch (e) { Alert.alert('Needs internet', (e as Error).message); }
        } },
    ]);
    const signOut = () => Alert.alert('Sign out?', 'Everything stored on this phone is removed. Your chats come back when you sign in again.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } },
    ]);

    const where = me?.member_type === 'student'
        ? [me.programme ?? me.department, me.level ? `${me.level} level` : null].filter(Boolean).join(' · ')
        : [me?.title, me?.department].filter(Boolean).join(' · ');

    return (
        <View style={ui.screen}>
            <TopBar title="Me" />
            <ScrollView>
                <View style={{ backgroundColor: '#fff', padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <Avatar name={me?.name ?? '?'} size={68} />
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text style={ui.h2}>{me?.name}</Text>
                        {where ? <Text style={ui.small}>{where}</Text> : null}
                        {me?.identifier ? <Text style={ui.small}>{me.identifier}</Text> : null}
                        <Text style={ui.small}>{me?.institution?.name}</Text>
                    </View>
                </View>
                {(me?.faculty || me?.residence) && (
                    <View style={{ backgroundColor: '#fff', marginTop: 10 }}>
                        {me?.faculty && <Row icon="school-outline" title={me.faculty} subtitle="Faculty" />}
                        {me?.residence && <Row icon="bed-outline" title={me.residence} subtitle="Hostel this session. Shown to responders if you press SOS." />}
                    </View>
                )}

                {me?.member_type === 'parent' && (
                    <>
                        <Text style={ui.sectionTitle}>My children</Text>
                        <View style={{ backgroundColor: '#fff' }}>
                            {(me.children ?? []).length === 0 && <Text style={[ui.small, { padding: 16 }]}>No students linked yet. Ask the school to link your child.</Text>}
                            {(me.children ?? []).map((c) => (
                                <ListRow key={c.name} title={c.name} subtitle={[c.relationship, c.department, c.level ? `${c.level} level` : null].filter(Boolean).join(' · ')} left={<Avatar name={c.name} size={44} />} />
                            ))}
                        </View>
                    </>
                )}

                <Text style={ui.sectionTitle}>Safety</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    <Row icon="location-outline" title="Attach my location to SOS" subtitle="Only responders and people helping nearby see it"
                        right={<Switch value={sosLocation} trackColor={{ true: colors.leaf }} onValueChange={(v) => { setSosLocation(v); kvSet('pref.sosLocation', v); }} />} />
                    {has('offline_mesh') && <Row icon="radio-outline" title="Offline and nearby" subtitle="Bluetooth and Wi-Fi relaying, phones around you" onPress={() => router.push('/nearby')} />}
                </View>

                {me?.face && me.permissions.includes('face.capture') && (
                    <>
                        <Text style={ui.sectionTitle}>Identity</Text>
                        <View style={{ backgroundColor: '#fff' }}>
                            <Row icon="scan-outline" title="Face capture" subtitle={me.face.done ? 'Captured. Tap to see or capture again.' : me.face.required ? 'Required by your institution. Takes about a minute.' : 'Optional. Takes about a minute.'}
                                onPress={() => router.push('/face-capture')} />
                        </View>
                    </>
                )}

                <Text style={ui.sectionTitle}>Me</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    <Row icon="musical-notes-outline" title="Profile and sounds" subtitle="Your WhatsApp number, and the tones for messages and calls" onPress={() => router.push('/profile-settings')} />
                </View>

                <Text style={ui.sectionTitle}>Devices</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    <Row icon="desktop-outline" title="Linked devices" subtitle="Use SOS Connect on a computer: scan the code on the sign-in page" onPress={() => router.push('/linked-devices')} />
                </View>

                <Text style={ui.sectionTitle}>Help</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    <Row icon="help-buoy-outline" title="Help" subtitle="How to use SOS Connect" onPress={() => router.push('/help')} />
                </View>

                <Text style={ui.sectionTitle}>Privacy</Text>
                <View style={{ backgroundColor: '#fff' }}>
                    <Row icon="document-text-outline" title="Privacy policy" onPress={() => Linking.openURL(`${config.apiUrl}/legal/privacy-policy`)} />
                    <Row icon="reader-outline" title="Terms" onPress={() => Linking.openURL(`${config.apiUrl}/legal/terms-of-service`)} />
                    <Row icon="download-outline" title="Download my data or make a request" onPress={() => Linking.openURL(`${config.apiUrl}/account/privacy`)} />
                    <Row icon="trash-outline" title="Delete my account" danger onPress={deleteAccount} />
                </View>

                <View style={{ backgroundColor: '#fff', marginTop: 10, marginBottom: 30 }}>
                    <Row icon="log-out-outline" title="Sign out" danger onPress={signOut} />
                </View>
            </ScrollView>
        </View>
    );
}
