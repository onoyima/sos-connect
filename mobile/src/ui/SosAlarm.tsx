import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Linking, Modal, Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { on } from '@/lib/events';
import { refreshBadges } from '@/sync/realtime';
import { Icon } from '@/ui/components';
import { colors } from '@/ui/theme';

type Alarm = {
    id: number; category: string; message: string | null; status: string; raised_at: string | null; location_label: string | null;
    lat: number | null; lng: number | null; accuracy_m: number | null; escalated?: boolean;
    user: { name: string | null; identifier: string | null; phone: string | null; department: string | null; residence: string | null };
    takenBy?: string | null;
};
const CATEGORY: Record<string, string> = { medical: 'Medical emergency', security: 'Security threat', fire: 'Fire', harassment: 'Harassment', accident: 'Accident', other: 'Emergency' };

let player: AudioPlayer | null = null;
async function siren(on: boolean) {
    if (!on) {
        Vibration.cancel();
        try { player?.pause(); player?.remove(); } catch { /* gone */ }
        player = null;
        return;
    }
    if (player) return;
    Vibration.vibrate([0, 900, 300, 900, 300, 900, 1200], true);
    try {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, allowsRecording: false });
        player = createAudioPlayer(require('../../assets/sounds/siren.wav'));
        player.loop = true;
        player.volume = 1;
        player.play();
    } catch { /* no sound: the screen and vibration still show it */ }
}

/**
 * The SOS alarm for responders, over everything in the app: siren, vibration, who and where, and "I'm responding".
 * It comes from the live connection, from the regular check, or from the push notification when the app is open,
 * and when the app opens while an alert is still unanswered.
 */
export function SosAlarm() {
    const { me, can, status } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [alarms, setAlarms] = useState<Alarm[]>([]);
    const [busy, setBusy] = useState(false);
    const silenced = useRef(new Set<number>());
    const pulse = useRef(new Animated.Value(1)).current;
    const responder = status === 'ready' && can('sos.view');
    const top = alarms[0];
    const ringing = !!top && !top.takenBy;

    const add = useCallback((a: Alarm) => {
        if (!a?.id || (silenced.current.has(a.id) && !a.escalated) || a.status !== 'open') return;
        setAlarms((list) => [a, ...list.filter((x) => x.id !== a.id)]);
    }, []);
    const remove = useCallback((id: number) => setAlarms((list) => list.filter((x) => x.id !== id)), []);

    const loadOpen = useCallback(() => {
        api<{ alerts: (Omit<Alarm, 'user'> & { user: Alarm['user'] | null })[]; responder: boolean }>('/sos?open=1')
            .then((r) => { if (r.responder) r.alerts.filter((a) => a.status === 'open' && a.user && a.user.name !== me?.name).forEach((a) => add({ ...a, user: a.user! })); })
            .catch(() => {});
    }, [add, me?.name]);

    useEffect(() => {
        if (!responder) return;
        loadOpen();
        const a = on('sosAlarm', (x) => add(x));
        const b = on('sosUpdate', (u) => {
            if (['resolved', 'false_alarm', 'cancelled'].includes(u.status)) { remove(u.id); return; }
            setAlarms((list) => list.map((x) => (x.id === u.id ? { ...x, status: u.status, takenBy: u.by } : x)));
            setTimeout(() => remove(u.id), 8000);
        });
        // The push arrives while the app is open: ring here too.
        const c = Notifications.addNotificationReceivedListener((n) => { if ((n.request.content.data as { type?: string })?.type === 'sos') loadOpen(); });
        return () => { a(); b(); c.remove(); };
    }, [responder, add, remove, loadOpen]);

    useEffect(() => {
        siren(ringing);
        if (!ringing) return;
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1.15, duration: 450, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [ringing, top?.id, pulse]);
    useEffect(() => () => { siren(false); }, []);

    if (!top) return null;

    const respond = async () => {
        setBusy(true);
        try {
            await api(`/sos/${top.id}/respond`, { body: { action: 'acknowledged' } });
            remove(top.id);
            refreshBadges();
            router.push('/sos');
        } catch (e) { /* offline: keep the alarm up so they can try again */ }
        setBusy(false);
    };
    const mute = () => { silenced.current.add(top.id); remove(top.id); };
    const open = () => { mute(); router.push('/sos'); };
    const map = top.lat !== null && top.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${top.lat},${top.lng}` : null;
    const line = (icon: any, text: string, onPress?: () => void) => (
        <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name={icon} size={19} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 15, flex: 1, textDecorationLine: onPress ? 'underline' : 'none' }}>{text}</Text>
        </Pressable>
    );

    return (
        <Modal visible animationType="fade" statusBarTranslucent onRequestClose={mute}>
            <ScrollView style={{ flex: 1, backgroundColor: colors.sos }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, overflow: 'hidden' }}>
                        {top.escalated ? 'Still no response' : 'SOS alert'}{alarms.length > 1 ? ` · ${alarms.length} open` : ''}
                    </Text>
                    <Pressable onPress={mute} accessibilityLabel="Silence this alarm" hitSlop={12}><Icon name="close" size={26} color="#fff" /></Pressable>
                </View>
                <Animated.View style={{ alignSelf: 'center', marginTop: 18, width: 92, height: 92, borderRadius: 46, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pulse }] }}>
                    <Icon name="alert" size={52} color={colors.sos} />
                </Animated.View>
                <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900', textAlign: 'center', marginTop: 16 }}>{CATEGORY[top.category] ?? 'Emergency'}</Text>
                <Text style={{ color: '#fff', fontSize: 17, textAlign: 'center', marginTop: 4 }}><Text style={{ fontWeight: '800' }}>{top.user.name ?? 'Someone'}</Text> needs help</Text>
                {top.message ? <Text style={{ color: '#fff', fontSize: 15, textAlign: 'center', marginTop: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12, overflow: 'hidden' }}>“{top.message}”</Text> : null}
                <View style={{ marginTop: 14, gap: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 14 }}>
                    {line('location', `${top.location_label ?? (map ? 'Location attached' : 'No location shared')}${top.accuracy_m ? ` (within ${top.accuracy_m} m)` : ''}${map ? ' · Open map' : ''}`, map ? () => Linking.openURL(map) : undefined)}
                    {(top.user.department || top.user.residence) ? line('person', [top.user.identifier, top.user.department, top.user.residence].filter(Boolean).join(' · ')) : null}
                    {top.user.phone ? line('call', top.user.phone, () => Linking.openURL(`tel:${top.user.phone}`)) : null}
                </View>
                {top.takenBy ? (
                    <Text style={{ marginTop: 18, backgroundColor: '#fff', color: colors.sos, fontWeight: '800', textAlign: 'center', padding: 14, borderRadius: 16, overflow: 'hidden' }}>{top.takenBy} is responding.</Text>
                ) : (
                    <View style={{ marginTop: 18, gap: 10 }}>
                        <Pressable onPress={respond} disabled={busy} style={{ backgroundColor: '#fff', borderRadius: 30, paddingVertical: 17, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
                            <Text style={{ color: colors.sos, fontSize: 19, fontWeight: '900' }}>{busy ? 'Telling them…' : "I'm responding"}</Text>
                        </Pressable>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <Pressable onPress={open} style={{ flex: 1, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', borderRadius: 30, paddingVertical: 13, alignItems: 'center' }}>
                                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Open alert</Text>
                            </Pressable>
                            <Pressable onPress={mute} style={{ flex: 1, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', borderRadius: 30, paddingVertical: 13, alignItems: 'center' }}>
                                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Silence</Text>
                            </Pressable>
                        </View>
                    </View>
                )}
            </ScrollView>
        </Modal>
    );
}
