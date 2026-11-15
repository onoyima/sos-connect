import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, TextInput, Vibration, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { db, kvGet } from '@/db/database';
import { on } from '@/lib/events';
import { raiseSos, SOS_CATEGORIES, smsFallback, updateSos } from '@/sos/sos';
import { SyncEngine } from '@/sync/SyncEngine';
import { Button, Icon, IconButton, TopBar, type IconName } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Row = { client_id: string; uuid: string | null; owner_id: number; owner_name: string; category: string; json: string; status: string; raised_at: string; mine: number; source: string };

export default function SosScreen() {
    const { me, can } = useAuth();
    const router = useRouter();
    const [category, setCategory] = useState('security');
    const [label, setLabel] = useState('');
    const [holding, setHolding] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [alerts, setAlerts] = useState<Row[]>([]);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const responder = can('sos.respond');
    const security = me?.institution?.security_phone;

    const load = useCallback(async () => {
        setAlerts(await (await db()).getAllAsync<Row>("SELECT * FROM sos WHERE raised_at > datetime('now', '-3 days') OR status IN ('open','acknowledged','responding') ORDER BY raised_at DESC LIMIT 50"));
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => on('sos', load), [load]);

    const fire = async () => {
        setHolding(false);
        Vibration.vibrate([0, 200, 100, 200]);
        const share = (await kvGet<boolean>('pref.sosLocation')) ?? true;
        try {
            const r = await raiseSos(category, label.trim() || null, share);
            setResult([
                r.server === 'sent' ? 'Responders have been alerted.' : 'No internet: saved and will send the moment any connection returns.',
                r.mesh > 0 ? `Also sent to ${r.mesh} phone(s) nearby, who pass it on.` : 'No phones nearby right now; it will pass to the next phone you meet.',
                r.location ? 'Location attached.' : 'No location attached.',
            ].join(' '));
            if (r.server !== 'sent' && security) {
                Alert.alert('Also send by SMS?', 'An SMS to campus security works without mobile data.', [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Send SMS', onPress: () => { smsFallback(security, category, label || null, r.coords); } },
                ]);
            }
        } catch (e) {
            Alert.alert('SOS', (e as Error).message);
        }
    };
    const CAT_ICON: Record<string, IconName> = { medical: 'medkit', security: 'shield', fire: 'flame', harassment: 'hand-left', accident: 'car', other: 'help-circle' };

    return (
        <View style={ui.screen}>
            <TopBar title="SOS" subtitle={SyncEngine.online ? 'Online' : 'Offline: works through phones nearby'}
                right={<IconButton name="radio-outline" label="Nearby phones" onPress={() => router.push('/nearby')} />} />
            <ScrollView contentContainerStyle={ui.pad}>
                <View style={[ui.card, { alignItems: 'center', gap: 14 }]}>
                    <Text style={[ui.h2, { alignSelf: 'flex-start' }]}>What's happening?</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'stretch' }}>
                        {SOS_CATEGORIES.map(([v, l]) => {
                            const on = category === v;
                            return (
                                <Pressable key={v} onPress={() => setCategory(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: on ? colors.sos : colors.line, backgroundColor: on ? '#fde8ea' : '#fff' }}>
                                    <Icon name={CAT_ICON[v] ?? 'alert'} size={16} color={on ? colors.sos : colors.muted} />
                                    <Text style={{ color: on ? colors.sosDark : colors.ink, fontWeight: '600' }}>{l}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <TextInput style={[ui.input, { alignSelf: 'stretch' }]} placeholder={me?.residence ? `Where are you? (e.g. ${me.residence})` : 'Where are you? (optional)'} value={label} onChangeText={setLabel} />
                    <Pressable
                        onPressIn={() => { setHolding(true); timer.current = setTimeout(fire, 1500); }}
                        onPressOut={() => { if (timer.current) clearTimeout(timer.current); setHolding(false); }}
                        accessibilityLabel="Hold to send SOS"
                        style={{ width: 196, height: 196, borderRadius: 98, backgroundColor: holding ? colors.sosDark : colors.sos, alignItems: 'center', justifyContent: 'center', borderWidth: 10, borderColor: holding ? '#f5b5bc' : '#fde8ea', marginVertical: 6 }}>
                        <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: 2 }}>SOS</Text>
                        <Text style={{ color: '#ffe3e6', fontWeight: '600' }}>{holding ? 'Keep holding…' : 'Hold 1.5 seconds'}</Text>
                    </Pressable>
                    {result && <View style={{ backgroundColor: colors.mint, borderRadius: 14, padding: 12, alignSelf: 'stretch' }}><Text style={ui.text}>{result}</Text></View>}
                    <Text style={[ui.small, { textAlign: 'center' }]}>{SyncEngine.online ? 'Goes to campus responders instantly, and to people nearby.' : 'Goes to people nearby over Bluetooth and Wi-Fi, and to responders as soon as any phone in the chain has internet.'}</Text>
                </View>

                {(security || (me?.institution?.emergency_numbers.length ?? 0) > 0) && (
                    <View style={[ui.card, { gap: 10 }]}>
                        <Text style={ui.h2}>Call for help</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {security && <Button variant="outline" icon="call" title="Campus security" onPress={() => Linking.openURL(`tel:${security}`)} />}
                            {me?.institution?.emergency_numbers.map((n) => <Button key={n} variant="outline" icon="call" title={n} onPress={() => Linking.openURL(`tel:${n}`)} />)}
                        </View>
                    </View>
                )}

                <Text style={[ui.h2, { marginTop: 6 }]}>{responder ? 'Alerts you can respond to' : 'Alerts'}</Text>
                {alerts.length === 0 && <Text style={ui.small}>None in the last 3 days.</Text>}
                {alerts.map((a) => {
                    const p = JSON.parse(a.json);
                    const open = ['open', 'acknowledged', 'responding'].includes(a.status);
                    const where = [p.location_label, p.user?.residence ? `Lives in ${p.user.residence}` : null].filter(Boolean).join(' · ');
                    return (
                        <View key={a.client_id} style={[ui.card, open && { borderLeftWidth: 4, borderLeftColor: colors.sos }]}>
                            <View style={ui.row}>
                                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: open ? '#fde8ea' : colors.mist, alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon name={CAT_ICON[a.category] ?? 'alert'} size={18} color={open ? colors.sos : colors.muted} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={ui.h2}>{a.mine ? 'Your alert' : a.owner_name}</Text>
                                    <Text style={ui.small}>{a.category} · {a.status.replace('_', ' ')} · {new Date(a.raised_at).toLocaleString()}</Text>
                                </View>
                            </View>
                            {where ? <Text style={ui.text}>{where}</Text> : null}
                            <Text style={ui.small}>{a.source === 'mesh' ? 'Received from a nearby phone' : a.source === 'me' ? 'Sent from this phone' : 'From the server'}</Text>
                            {p.lat != null && <Button variant="outline" icon="navigate" title="Open location in maps" onPress={() => Linking.openURL(`https://maps.google.com/?q=${p.lat},${p.lng}`)} />}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {open && a.mine === 1 && <Button title="I'm safe now" icon="checkmark" onPress={() => updateSos(a.client_id, a.uuid, a.owner_id, 'cancelled')} />}
                                {open && !a.mine && responder && (['acknowledged', 'on_my_way', 'arrived', 'resolved'] as const).map((act) => (
                                    <Button key={act} variant="outline" title={act === 'on_my_way' ? 'On my way' : act[0].toUpperCase() + act.slice(1)} onPress={() => updateSos(a.client_id, a.uuid, a.owner_id, act)} />
                                ))}
                                {open && !a.mine && !responder && <Button variant="outline" icon="walk" title="I'm nearby, coming" onPress={() => updateSos(a.client_id, a.uuid, a.owner_id, 'note', `${me?.name} is nearby and coming to help`)} />}
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}
