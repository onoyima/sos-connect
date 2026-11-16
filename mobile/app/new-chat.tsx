import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { usePeopleSearch, type Person } from '@/chat/people';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, Button, EmptyState, Icon, ListRow, Pill } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/**
 * Find someone and chat. People you may message straight away open the chat at once; for anyone else you send a
 * chat request with a short note, and the chat (and calls) open when they accept.
 */
export default function NewChat() {
    const router = useRouter();
    const { can, has } = useAuth();
    const [q, setQ] = useState('');
    const [who, setWho] = useState<'' | 'student' | 'staff'>('');
    const { people, records, busy, searched, patch, addFromRecords } = usePeopleSearch(q, who);
    const [asking, setAsking] = useState<Person | null>(null);
    const [note, setNote] = useState('');
    const [working, setWorking] = useState<number | null>(null);
    const direct = has('direct_chat') && can('chat.direct');
    const groups = has('custom_groups') && can('groups.create');

    const go = async (p: Person, fn: () => Promise<void>) => {
        setWorking(p.id);
        try { await fn(); } catch (e) { Alert.alert('Not done', (e as Error).message); } finally { setWorking(null); }
    };
    const open = async (conversationId: number) => {
        await SyncEngine.refreshConversations();
        router.replace(`/chat/${conversationId}`);
    };
    const chat = (p: Person) => go(p, async () => open((await api<{ conversation_id: number }>('/conversations/direct', { body: { user_id: p.id } })).conversation_id));
    const send = (p: Person) => go(p, async () => {
        const r = await api<{ request?: { id: number }; conversation_id?: number }>('/chat-requests', { body: { user_id: p.id, message: note.trim() || null } });
        if (r.conversation_id) return open(r.conversation_id);
        patch(p.id, { reach: 'requested', request_id: r.request?.id ?? null });
        setAsking(null); setNote('');
        Alert.alert('Request sent', `You can chat and call ${p.name} once they accept.`);
    });
    const cancel = (p: Person) => go(p, async () => { await api(`/chat-requests/${p.request_id}`, { method: 'DELETE' }); patch(p.id, { reach: 'request', request_id: null }); });
    const accept = (p: Person) => go(p, async () => open((await api<{ conversation_id: number }>(`/chat-requests/${p.request_id}/accept`, { method: 'POST' })).conversation_id));

    const Action = ({ p }: { p: Person }) => {
        if (working === p.id) return <ActivityIndicator color={colors.leaf} />;
        const r = p.reach ?? 'direct';
        const btn = (label: string, onPress: () => void, filled = true) => (
            <Pressable onPress={onPress} style={{ backgroundColor: filled ? colors.leaf : colors.mist, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: filled ? '#fff' : colors.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
        );
        if (r === 'direct') return btn('Chat', () => chat(p));
        if (r === 'request') return btn('Request', () => { setNote(''); setAsking(p); }, false);
        if (r === 'requested') return btn('Requested ✕', () => cancel(p), false);
        if (r === 'accept') return btn('Accept', () => accept(p));
        return <Text style={[ui.small, { maxWidth: 120, textAlign: 'right' }]} numberOfLines={2}>{p.reach_note ?? "Can't be reached"}</Text>;
    };

    return (
        <View style={ui.screen}>
            <BackBar title="New chat" subtitle={SyncEngine.online ? null : 'Needs internet'} />
            <View style={{ backgroundColor: '#fff' }}>
                {groups && <ListRow title="New group" left={<Avatar name="g" icon="people" />} onPress={() => router.push('/new-group')} />}
                {direct && (
                    <>
                        <View style={[ui.row, { marginHorizontal: 16, marginTop: 12, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14 }]}>
                            <Icon name="search" size={18} color={colors.muted} />
                            <TextInput autoFocus style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: colors.ink }} placeholder="Search by name, matric or staff number"
                                placeholderTextColor={colors.muted} value={q} onChangeText={setQ} />
                            {busy && <ActivityIndicator color={colors.leaf} />}
                        </View>
                        <View style={[ui.row, { gap: 8, paddingHorizontal: 16, paddingVertical: 10 }]}>
                            <Pill label="Everyone" active={who === ''} onPress={() => setWho('')} />
                            <Pill label="Students" active={who === 'student'} onPress={() => setWho('student')} />
                            <Pill label="Staff" active={who === 'staff'} onPress={() => setWho('staff')} />
                        </View>
                    </>
                )}
            </View>
            <FlatList
                data={people}
                keyExtractor={(p) => String(p.id)}
                style={{ backgroundColor: '#fff' }}
                keyboardShouldPersistTaps="handled"
                ListFooterComponent={records.length ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
                        <Text style={[ui.small, { paddingHorizontal: 16, fontWeight: '700' }]}>NOT ON SOS CONNECT YET</Text>
                        {records.map((r) => (
                            <ListRow key={r.external_id} title={r.name} subtitle={`${[r.member_type === 'staff' ? 'Staff' : r.member_type === 'alumni' ? 'Alumni' : 'Student', r.department].filter(Boolean).join(' · ')} · from the school records`} left={<Avatar name={r.name} size={44} />}
                                right={<Pressable onPress={() => addFromRecords(r).catch((e) => Alert.alert('Not added', (e as Error).message))}
                                    style={{ backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>Add</Text></Pressable>} />
                        ))}
                        <Text style={[ui.small, { padding: 16 }]}>They'll see your message or request the first time they sign in.</Text>
                    </View>
                ) : null}
                ListEmptyComponent={direct && searched && !busy && !records.length
                    ? <EmptyState icon="person-outline" title="No one found">People appear here after they first sign in. Try a different name or number.</EmptyState>
                    : direct && q.trim().length < 2 ? <Text style={[ui.small, { padding: 16, textAlign: 'center' }]}>Type at least two letters of a name, or a full matric or staff number.</Text> : null}
                renderItem={({ item }) => (
                    <ListRow title={item.name} subtitle={[item.title, item.department, item.level ? `${item.level} level` : null].filter(Boolean).join(' · ')}
                        left={<Avatar name={item.name} size={44} />} right={<Action p={item} />} />
                )}
            />

            <Modal visible={!!asking} transparent animationType="fade" onRequestClose={() => setAsking(null)}>
                <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 }} onPress={() => setAsking(null)}>
                    <Pressable style={{ backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 12 }} onPress={() => {}}>
                        <Text style={ui.h2}>Chat request to {asking?.name}</Text>
                        <Text style={ui.small}>They need to accept before you can chat or call. Say who you are and why (optional).</Text>
                        <TextInput value={note} onChangeText={setNote} maxLength={300} multiline placeholder="Hi, I'm in your 200 level class…" placeholderTextColor={colors.muted}
                            style={{ backgroundColor: colors.mist, borderRadius: 12, padding: 12, minHeight: 80, fontSize: 15, color: colors.ink, textAlignVertical: 'top' }} />
                        <View style={[ui.row, { justifyContent: 'flex-end', gap: 10 }]}>
                            <Button title="Cancel" variant="outline" onPress={() => setAsking(null)} />
                            <Button title="Send request" icon="send" busy={working === asking?.id} onPress={() => asking && send(asking)} />
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    );
}
