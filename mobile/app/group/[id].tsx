import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { usePeopleSearch, type Person } from '@/chat/people';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, Button, EmptyState, Icon, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Info = {
    id: number; type: string; auto_type: string | null; name: string | null; description: string | null; posting: string; community: string | null;
    member_count: number; my_role: string; my_admin_permissions: string[];
    can: { post: boolean; members: boolean; settings: boolean; admins: boolean; delete_messages: boolean; leave: boolean };
    admin_permission_labels: Record<string, string>;
};
type Member = { id: number; name: string; title?: string | null; department?: string | null; role: string; admin_permissions: string[]; managed: boolean };

/**
 * Group info, like any chat app: who's in it, mute, leave. Group admins also get the group's own controls
 * (rename, who can post, add/remove people, make admins) - only the powers they were given for this group.
 * Institution-wide administration (roles, structure, settings) is on the website, not here.
 */
export default function GroupInfo() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const cid = Number(id);
    const router = useRouter();
    const { me, can: canDo, has } = useAuth();
    const [info, setInfo] = useState<Info | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [muted, setMuted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [powersFor, setPowersFor] = useState<Member | null>(null);
    const [nextPage, setNextPage] = useState<number | null>(null);
    const [memberQ, setMemberQ] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);

    /** Members a page at a time (50 each), optionally filtered by name. */
    const loadMembers = useCallback(async (page = 1, q = memberQ) => {
        const r = await api<{ members: Member[]; next_page: number | null }>(`/conversations/${cid}/members?page=${page}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
        setMembers((prev) => (page === 1 ? r.members : [...prev, ...r.members.filter((m) => !prev.some((p) => p.id === m.id))]));
        setNextPage(r.next_page);
    }, [cid, memberQ]);

    const load = useCallback(async () => {
        try {
            const i = await api<{ conversation: Info }>(`/conversations/${cid}`);
            setInfo(i.conversation);
            await loadMembers(1);
            const row = await (await db()).getFirstAsync<{ muted: number }>('SELECT muted FROM conversations WHERE id = ?', cid);
            setMuted(!!row?.muted);
        } catch (e) {
            setError(SyncEngine.online ? (e as Error).message : 'Group info needs internet.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cid]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!info) return;
        const t = setTimeout(() => loadMembers(1, memberQ).catch(() => {}), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memberQ]);

    const patch = async (body: Record<string, unknown>) => {
        try { await api(`/conversations/${cid}`, { method: 'PATCH', body }); await SyncEngine.refreshConversations(); await load(); }
        catch (e) { Alert.alert('Not saved', (e as Error).message); }
    };
    const toggleMute = async (v: boolean) => { setMuted(v); await patch({ muted: v }); };

    const memberActions = (m: Member) => {
        if (!info || m.id === me?.id) return;
        const opts: { label: string; run: () => void; danger?: boolean }[] = [];
        if (m.id !== me?.id) opts.push({ label: 'View profile', run: () => router.push(`/profile/${m.id}`) });
        if (info.type !== 'direct' && has('direct_chat') && canDo('chat.direct')) opts.push({ label: `Message ${m.name.split(' ')[0]}`, run: async () => {
            try { const r = await api<{ conversation_id: number }>('/conversations/direct', { body: { user_id: m.id } }); await SyncEngine.refreshConversations(); router.push(`/chat/${r.conversation_id}`); }
            catch (e) { Alert.alert("Can't start a chat", (e as Error).message); }
        } });
        if (info.can.admins) opts.push(m.role === 'admin'
            ? { label: 'Dismiss as admin', run: () => setRole(m, 'member') }
            : { label: 'Make group admin', run: () => setPowersFor(m) });
        if (info.can.admins && m.role === 'admin') opts.push({ label: 'Change admin powers', run: () => setPowersFor(m) });
        if (info.can.members) opts.push({ label: 'Remove from group', danger: true, run: () => Alert.alert(`Remove ${m.name}?`, m.managed ? 'They were added from the institution records. Only staff with group powers for this area can remove them.' : undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => api(`/conversations/${cid}/members/${m.id}`, { method: 'DELETE' }).then(load).catch((e) => Alert.alert('Not removed', e.message)) },
        ]) });
        if (!opts.length) return;
        Alert.alert(m.name, m.title ?? undefined, [...opts.map((o) => ({ text: o.label, style: o.danger ? 'destructive' as const : 'default' as const, onPress: o.run })), { text: 'Cancel', style: 'cancel' as const }]);
    };

    const setRole = async (m: Member, role: 'admin' | 'member', powers?: string[]) => {
        try { await api(`/conversations/${cid}/members/${m.id}`, { method: 'PATCH', body: { role, admin_permissions: powers ?? null } }); setPowersFor(null); await load(); }
        catch (e) { Alert.alert('Not changed', (e as Error).message); }
    };

    const leave = () => Alert.alert('Leave this group?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: async () => {
            try { await api(`/conversations/${cid}/members/${me?.id}`, { method: 'DELETE' }); await SyncEngine.refreshConversations(); router.replace('/'); }
            catch (e) { Alert.alert('Not left', (e as Error).message); }
        } },
    ]);

    if (error) return <View style={ui.screen}><BackBar title="Info" /><EmptyState icon="cloud-offline-outline" title={error} /></View>;
    if (!info) return <View style={ui.screen}><BackBar title="Info" /><ActivityIndicator color={colors.leaf} style={{ marginTop: 40 }} /></View>;

    const direct = info.type === 'direct';
    const peer = direct ? members.find((m) => m.id !== me?.id) : null;
    const title = direct ? peer?.name ?? 'Chat' : info.name ?? 'Group';

    return (
        <View style={ui.screen}>
            <BackBar title={direct ? 'Contact info' : 'Group info'} />
            <ScrollView>
                <View style={{ backgroundColor: '#fff', alignItems: 'center', padding: 24, gap: 6 }}>
                    <Avatar name={title} size={96} icon={direct ? undefined : 'people'} />
                    <Text style={[ui.h1, { textAlign: 'center' }]}>{title}</Text>
                    <Text style={ui.small}>{direct ? [peer?.title, peer?.department].filter(Boolean).join(' · ') : `Group · ${info.member_count} members${info.community ? ` · ${info.community}` : ''}`}</Text>
                    {info.can.settings && !direct && <Pressable onPress={() => setEditing(true)}><Text style={{ color: colors.leaf, fontWeight: '600', marginTop: 6 }}>Edit name and description</Text></Pressable>}
                </View>
                {info.description ? <Text style={[ui.text, { backgroundColor: '#fff', padding: 16, marginTop: 10 }]}>{info.description}</Text> : null}

                <View style={{ backgroundColor: '#fff', marginTop: 10 }}>
                    <ListRow title="Mute notifications" left={<Icon name="volume-mute-outline" color={colors.muted} />} right={<Switch value={muted} onValueChange={toggleMute} trackColor={{ true: colors.leaf }} />} />
                    {info.can.settings && !direct && (
                        <ListRow title="Only admins can send messages" subtitle={info.posting === 'admins' ? 'On: everyone else can only read' : 'Off: all members can send'}
                            left={<Icon name="megaphone-outline" color={colors.muted} />}
                            right={<Switch value={info.posting === 'admins'} onValueChange={(v) => patch({ posting: v ? 'admins' : 'everyone' })} trackColor={{ true: colors.leaf }} />} />
                    )}
                    {info.my_role === 'admin' && !direct && (
                        <ListRow title="You're a group admin" subtitle={info.my_admin_permissions.map((p) => info.admin_permission_labels[p] ?? p).join(', ')} left={<Icon name="shield-checkmark-outline" color={colors.leaf} />} />
                    )}
                </View>

                {!direct && (
                    <>
                        <Text style={ui.sectionTitle}>{info.member_count} members</Text>
                        <View style={{ backgroundColor: '#fff' }}>
                            {info.member_count > 10 && (
                                <View style={[ui.row, { marginHorizontal: 16, marginVertical: 8, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14 }]}>
                                    <Icon name="search" size={17} color={colors.muted} />
                                    <TextInput style={{ flex: 1, paddingVertical: 9, fontSize: 15, color: colors.ink }} placeholder="Find a member" placeholderTextColor={colors.muted} value={memberQ} onChangeText={setMemberQ} />
                                </View>
                            )}
                            {info.can.members && <ListRow title="Add people" left={<Avatar name="+" icon="person-add" size={44} />} onPress={() => setAdding(true)} />}
                            {members.map((m) => (
                                <ListRow key={m.id} title={m.id === me?.id ? 'You' : m.name} subtitle={[m.title, m.department].filter(Boolean).join(' · ')}
                                    left={<Avatar name={m.name} size={44} />} onPress={() => memberActions(m)}
                                    right={m.role === 'admin' ? <Text style={{ color: colors.leaf, fontSize: 12, fontWeight: '700', backgroundColor: colors.mint, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' }}>Admin</Text> : null} />
                            ))}
                            {nextPage && (
                                <Pressable onPress={async () => { setLoadingMore(true); try { await loadMembers(nextPage); } finally { setLoadingMore(false); } }} style={{ padding: 16, alignItems: 'center' }}>
                                    {loadingMore ? <ActivityIndicator color={colors.leaf} /> : <Text style={{ color: colors.leaf, fontWeight: '700' }}>Show more members</Text>}
                                </Pressable>
                            )}
                        </View>
                    </>
                )}

                <View style={{ backgroundColor: '#fff', marginTop: 10, marginBottom: 30 }}>
                    {info.can.leave && <ListRow title="Leave group" danger left={<Icon name="exit-outline" color={colors.sos} />} onPress={leave} />}
                    {!info.can.leave && !direct && <Text style={[ui.small, { padding: 16 }]}>You're in this group because of your records at the institution, so you can mute it but not leave it.</Text>}
                </View>
            </ScrollView>

            {editing && <EditGroup info={info} onClose={() => setEditing(false)} onSave={async (b) => { await patch(b); setEditing(false); }} />}
            {adding && <AddPeople onClose={() => setAdding(false)} onPick={async (p) => {
                try { await api(`/conversations/${cid}/members`, { body: { user_id: p.id } }); await load(); } catch (e) { Alert.alert('Not added', (e as Error).message); }
            }} />}
            {powersFor && <Powers member={powersFor} labels={info.admin_permission_labels} mine={info.my_admin_permissions} onClose={() => setPowersFor(null)} onSave={(p) => setRole(powersFor, 'admin', p)} />}
        </View>
    );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    return (
        <Modal visible animationType="slide" transparent onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
                <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12, maxHeight: '85%' }}>
                    <View style={[ui.row, { justifyContent: 'space-between' }]}>
                        <Text style={ui.h2}>{title}</Text>
                        <Pressable onPress={onClose} hitSlop={10}><Icon name="close" /></Pressable>
                    </View>
                    {children}
                </View>
            </View>
        </Modal>
    );
}

function EditGroup({ info, onClose, onSave }: { info: Info; onClose: () => void; onSave: (b: { name: string; description: string | null }) => void }) {
    const [name, setName] = useState(info.name ?? '');
    const [description, setDescription] = useState(info.description ?? '');
    return (
        <Sheet title="Edit group" onClose={onClose}>
            <TextInput style={ui.input} value={name} onChangeText={setName} maxLength={120} placeholder="Group name" />
            <TextInput style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} maxLength={500} multiline placeholder="Description" />
            <Button title="Save" onPress={() => onSave({ name: name.trim(), description: description.trim() || null })} disabled={!name.trim()} />
        </Sheet>
    );
}

function AddPeople({ onClose, onPick }: { onClose: () => void; onPick: (p: Person) => void }) {
    const [q, setQ] = useState('');
    const { people, busy } = usePeopleSearch(q);
    return (
        <Sheet title="Add people" onClose={onClose}>
            <TextInput autoFocus style={ui.input} placeholder="Search by name or number" value={q} onChangeText={setQ} />
            {busy && <ActivityIndicator color={colors.leaf} />}
            <FlatList data={people} keyExtractor={(p) => String(p.id)} style={{ maxHeight: 360 }}
                renderItem={({ item }) => <ListRow title={item.name} subtitle={[item.title, item.department].filter(Boolean).join(' · ')} left={<Avatar name={item.name} size={40} />}
                    right={<Icon name="add-circle" color={colors.leaf} />} onPress={() => onPick(item)} />} />
        </Sheet>
    );
}

function Powers({ member, labels, mine, onClose, onSave }: { member: Member; labels: Record<string, string>; mine: string[]; onClose: () => void; onSave: (p: string[]) => void }) {
    const [picked, setPicked] = useState<string[]>(member.role === 'admin' ? member.admin_permissions : ['post']);
    return (
        <Sheet title={`${member.name.split(' ')[0]}'s admin powers`} onClose={onClose}>
            <Text style={ui.small}>You can only give powers you have yourself in this group.</Text>
            {Object.entries(labels).map(([k, label]) => (
                <ListRow key={k} title={label} right={<Switch value={picked.includes(k)} disabled={!mine.includes(k)} trackColor={{ true: colors.leaf }}
                    onValueChange={(v) => setPicked((p) => (v ? [...p, k] : p.filter((x) => x !== k)))} />} />
            ))}
            <Button title="Save" onPress={() => onSave(picked)} disabled={picked.length === 0} />
        </Sheet>
    );
}
