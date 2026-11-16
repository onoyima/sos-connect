import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useCalls } from '@/calls/CallContext';
import { api } from '@/lib/api';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Person = {
    id: number; name: string; member_type?: string; department?: string | null; level?: number | null; last_seen_at?: string | null;
    phone?: string | null; whatsapp?: string | null; reach?: string; reach_note?: string | null; conversation_id?: number | null; shared_groups?: number;
};

const seen = (iso?: string | null) => {
    if (!iso) return 'Not on SOS Connect yet';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    return m < 3 ? 'Online recently' : m < 60 ? `Last seen ${m} min ago` : m < 1440 ? `Last seen ${Math.round(m / 60)} h ago` : `Last seen ${new Date(iso).toLocaleDateString()}`;
};
const typeLabel = (t?: string) => ({ student: 'Student', staff: 'Staff', parent: 'Parent', alumni: 'Alumni' } as Record<string, string>)[t ?? ''] ?? '';

/** Someone's profile: their WhatsApp (opens the WhatsApp app), a phone call, and ways to reach them here. */
export default function Profile() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const calls = useCalls();
    const [p, setP] = useState<Person | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { api<{ person: Person }>(`/people/${id}`).then((r) => setP(r.person)).catch((e) => setError(e.message)); }, [id]);

    const whatsapp = async () => {
        if (!p?.whatsapp) return;
        // The WhatsApp app if it's installed, otherwise WhatsApp's own web link.
        const app = `whatsapp://send?phone=${p.whatsapp}`;
        try { (await Linking.canOpenURL(app)) ? await Linking.openURL(app) : await Linking.openURL(`https://wa.me/${p.whatsapp}`); }
        catch { Linking.openURL(`https://wa.me/${p.whatsapp}`); }
    };
    const message = async () => {
        if (!p) return;
        try {
            const cid = p.conversation_id ?? (await api<{ conversation_id: number }>('/conversations/direct', { body: { user_id: p.id } })).conversation_id;
            await SyncEngine.refreshConversations();
            router.replace(`/chat/${cid}`);
        } catch (e) { Alert.alert("Can't start a chat", (e as Error).message); }
    };
    const request = async () => {
        if (!p) return;
        try {
            const r = await api<{ conversation_id?: number }>('/chat-requests', { body: { user_id: p.id } });
            if (r.conversation_id) { await SyncEngine.refreshConversations(); router.replace(`/chat/${r.conversation_id}`); }
            else setP({ ...p, reach: 'requested' });
        } catch (e) { Alert.alert('Not sent', (e as Error).message); }
    };
    const canChat = !!p && (!!p.conversation_id || p.reach === 'direct');
    const call = (type: 'voice' | 'video') => p && calls.start({ id: p.id, name: p.name }, type).catch((e) => Alert.alert('Call', e.message));

    return (
        <View style={ui.screen}>
            <BackBar title="Profile" />
            {!p && !error && <ActivityIndicator style={{ marginTop: 40 }} color={colors.leaf} />}
            {error && <Text style={{ padding: 20, color: colors.sos }}>{error}</Text>}
            {p && (
                <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                    <View style={{ alignItems: 'center', backgroundColor: '#fff', paddingVertical: 24, paddingHorizontal: 16 }}>
                        <Avatar name={p.name} size={96} />
                        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 12, textAlign: 'center' }}>{p.name}</Text>
                        <Text style={{ color: colors.muted, marginTop: 2, textAlign: 'center' }}>{[typeLabel(p.member_type), p.department, p.level ? `${p.level} level` : null].filter(Boolean).join(' · ')}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{seen(p.last_seen_at)}</Text>
                    </View>

                    <View style={{ backgroundColor: '#fff', marginTop: 10, padding: 16 }}>
                        {p.whatsapp ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <Pressable onPress={() => Linking.openURL(`tel:+${p.whatsapp}`)} style={{ flex: 1 }} accessibilityLabel={`Call ${p.phone}`}>
                                    <Text style={{ color: colors.muted, fontSize: 12 }}>Phone</Text>
                                    <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>{p.phone}</Text>
                                </Pressable>
                                <Pressable onPress={whatsapp} accessibilityLabel={`Open ${p.name} on WhatsApp`}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1fa855', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22 }}>
                                    <Icon name="chatbubble-ellipses" size={18} color="#fff" />
                                    <Text style={{ color: '#fff', fontWeight: '800' }}>WhatsApp</Text>
                                </Pressable>
                            </View>
                        ) : <Text style={{ color: colors.muted }}>No phone number shared.</Text>}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
                        {canChat ? <Act icon="chatbubble-outline" label="Message" onPress={message} />
                            : p.reach === 'request' ? <Act icon="person-add-outline" label="Request" onPress={request} />
                            : <Act icon="person-add-outline" label={p.reach === 'requested' ? 'Requested' : p.reach === 'accept' ? 'Asked you' : 'Message'} disabled />}
                        <Act icon="call-outline" label="Voice" onPress={() => call('voice')} disabled={!canChat} />
                        <Act icon="videocam-outline" label="Video" onPress={() => call('video')} disabled={!canChat} />
                    </View>
                    {p.reach_note ? <Text style={{ textAlign: 'center', color: colors.muted, paddingHorizontal: 16 }}>{p.reach_note}</Text> : null}
                    {p.shared_groups ? <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 8 }}>{p.shared_groups} group{p.shared_groups === 1 ? '' : 's'} in common</Text> : null}
                </ScrollView>
            )}
        </View>
    );
}

const Act = ({ icon, label, onPress, disabled }: { icon: any; label: string; onPress?: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14, borderRadius: 16, backgroundColor: colors.mist, opacity: disabled ? 0.4 : 1 }}>
        <Icon name={icon} size={22} color={colors.grove} />
        <Text style={{ color: colors.grove, fontWeight: '700' }}>{label}</Text>
    </Pressable>
);
