import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { fetchRequests, type ChatRequest } from '@/chat/people';
import { currentBadges } from '@/sync/realtime';
import { Avatar } from '@/ui/components';
import { useAuth } from '@/auth/AuthContext';
import { db } from '@/db/database';
import { on } from '@/lib/events';
import { SyncEngine } from '@/sync/SyncEngine';
import { ChatListItem, type ChatRow } from '@/chat/ChatListItem';
import { EmptyState, Fab, Icon, IconButton, OfflineBanner, Pill, TopBar } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/** WhatsApp-style "loading your chats" while the first sync runs, instead of an empty list. */
function FirstLoad() {
    const x = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [x]);
    return (
        <View style={{ paddingTop: 60, alignItems: 'center', gap: 14 }}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>Loading your chats…</Text>
            <View style={{ width: 200, height: 4, borderRadius: 4, backgroundColor: colors.mist, overflow: 'hidden' }}>
                <Animated.View style={{ width: 80, height: 4, borderRadius: 4, backgroundColor: colors.leaf, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-80, 200] }) }] }} />
            </View>
            <Text style={[ui.small, { textAlign: 'center', paddingHorizontal: 40 }]}>Your groups and messages are being brought in. This only takes long the first time.</Text>
        </View>
    );
}

export default function Chats() {
    const router = useRouter();
    const { me, can, has } = useAuth();
    const [rows, setRows] = useState<ChatRow[]>([]);
    const [online, setOnline] = useState(SyncEngine.online);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'unread' | 'groups' | 'direct'>('all');
    const [q, setQ] = useState('');
    const [requests, setRequests] = useState<ChatRequest[]>([]);
    const [missed, setMissed] = useState(currentBadges().calls);
    useEffect(() => on('badges', (b) => setMissed(b.calls)), []);
    const loadRequests = useCallback(() => { if (SyncEngine.online && can('chat.use')) fetchRequests().then((r) => setRequests(r.incoming)).catch(() => {}); }, [can]);
    useFocusEffect(useCallback(() => { loadRequests(); }, [loadRequests]));
    useEffect(() => on('chatRequest', loadRequests), [loadRequests]);
    const answer = async (r: ChatRequest, yes: boolean) => {
        try {
            const res = await api<{ conversation_id?: number }>(`/chat-requests/${r.id}/${yes ? 'accept' : 'decline'}`, { method: 'POST' });
            setRequests((l) => l.filter((x) => x.id !== r.id));
            if (yes && res.conversation_id) { await SyncEngine.refreshConversations(); router.push(`/chat/${res.conversation_id}`); }
        } catch (e) { Alert.alert('Not done', (e as Error).message); }
    };

    const load = useCallback(async () => {
        setRows(await (await db()).getAllAsync<ChatRow>('SELECT * FROM conversations ORDER BY COALESCE(last_message_at, \'\') DESC, name'));
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => {
        const a = on('conversations', load);
        const b = on('online', setOnline);
        return () => { a(); b(); };
    }, [load]);

    const shown = useMemo(() => rows.filter((r) =>
        (filter === 'all' || (filter === 'unread' && r.unread > 0) || (filter === 'groups' && r.type !== 'direct') || (filter === 'direct' && r.type === 'direct'))
        && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))), [rows, filter, q]);

    const canStart = (has('direct_chat') && can('chat.direct')) || (has('custom_groups') && can('groups.create'));

    if (!can('chat.use')) {
        return (
            <View style={ui.screen}>
                <TopBar title="Chats" subtitle={me?.institution?.name} />
                <EmptyState icon="lock-closed-outline" title="Chat isn't on for your account yet">
                    {me?.needs_guardian_consent
                        ? 'You are under 18, so your institution has to record your parent or guardian\'s consent first. SOS works now.'
                        : 'Your institution controls who can chat. SOS and notices still work.'}
                </EmptyState>
            </View>
        );
    }

    return (
        <View style={ui.screen}>
            <TopBar title="Chats" subtitle={me?.institution?.name}
                right={<>
                    {(has('voice_calls') || has('video_calls')) && (
                        <View>
                            <IconButton name="call-outline" label={missed ? `Calls, ${missed} missed` : 'Calls'} onPress={() => router.push('/calls')} />
                            {missed > 0 && (
                                <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.sos, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: colors.grove }}>
                                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{missed > 99 ? '99+' : missed}</Text>
                                </View>
                            )}
                        </View>
                    )}
                    <IconButton name="radio-outline" label="Nearby phones" onPress={() => router.push('/nearby')} />
                </>} />
            {!online && <OfflineBanner onPress={() => router.push('/nearby')} />}
            <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 10 }}>
                <View style={[ui.row, { backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14 }]}>
                    <Icon name="search" size={18} color={colors.muted} />
                    <TextInput style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: colors.ink }} placeholder="Search chats" placeholderTextColor={colors.muted} value={q} onChangeText={setQ} />
                </View>
                <View style={[ui.row, { gap: 8 }]}>
                    <Pill label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
                    <Pill label="Unread" active={filter === 'unread'} onPress={() => setFilter('unread')} />
                    <Pill label="Groups" active={filter === 'groups'} onPress={() => setFilter('groups')} />
                    {has('direct_chat') && <Pill label="Private" active={filter === 'direct'} onPress={() => setFilter('direct')} />}
                </View>
            </View>
            {requests.length > 0 && (
                <View style={{ backgroundColor: colors.mint, paddingVertical: 6 }}>
                    <Text style={{ fontWeight: '700', color: colors.grove, paddingHorizontal: 16, paddingVertical: 6 }}>Chat requests · {requests.length}</Text>
                    {requests.map((r) => (
                        <View key={r.id} style={{ flexDirection: 'row', gap: 12, backgroundColor: '#fff', marginHorizontal: 10, marginBottom: 6, borderRadius: 14, padding: 12 }}>
                            <Avatar name={r.person.name} size={42} />
                            <View style={{ flex: 1, gap: 4 }}>
                                <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={1}>{r.person.name}</Text>
                                <Text style={ui.small} numberOfLines={1}>{[r.person.title, r.person.department].filter(Boolean).join(' · ')}</Text>
                                {r.message ? <Text style={ui.text}>{r.message}</Text> : null}
                                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                                    <Pressable onPress={() => answer(r, true)} style={{ backgroundColor: colors.leaf, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 }}><Text style={{ color: '#fff', fontWeight: '700' }}>Accept</Text></Pressable>
                                    <Pressable onPress={() => answer(r, false)} style={{ backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 }}><Text style={{ color: colors.ink, fontWeight: '700' }}>Decline</Text></Pressable>
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            )}
            <FlatList
                data={shown}
                keyExtractor={(r) => String(r.id)}
                style={{ backgroundColor: '#fff' }}
                refreshControl={<RefreshControl colors={[colors.leaf]} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await SyncEngine.run(); await load(); setRefreshing(false); }} />}
                ListEmptyComponent={rows.length === 0 && online && !SyncEngine.firstDone
                    ? <FirstLoad />
                    : rows.length === 0
                    ? <EmptyState icon="chatbubbles-outline" title="Your groups will appear here">They're set up from your faculty, department, level and courses after the first sync.</EmptyState>
                    : <EmptyState icon="search" title="Nothing matches" />}
                renderItem={({ item }) => <ChatListItem item={item} meId={me?.id} onPress={() => router.push(`/chat/${item.id}`)} />}
            />
            {canStart && <Fab icon="chatbox-ellipses" label="New chat" onPress={() => router.push('/new-chat')} />}
        </View>
    );
}
