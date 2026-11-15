import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, Button, Icon, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';
import { usePeopleSearch, type Person } from '@/chat/people';

export default function NewGroup() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState<Person[]>([]);
    const [busy, setBusy] = useState(false);
    const { people } = usePeopleSearch(q);

    const toggle = (p: Person) => setPicked((l) => (l.some((x) => x.id === p.id) ? l.filter((x) => x.id !== p.id) : [...l, p]));
    const create = async () => {
        setBusy(true);
        try {
            const r = await api<{ conversation_id: number; skipped: number[] }>('/conversations/group', { body: { name: name.trim(), description: description.trim() || null, member_ids: picked.map((p) => p.id) } });
            await SyncEngine.refreshConversations();
            if (r.skipped.length) Alert.alert('Group made', `${r.skipped.length} person(s) weren't added: they need to accept a chat request from you first.`);
            router.replace(`/chat/${r.conversation_id}`);
        } catch (e) {
            Alert.alert("Couldn't make the group", (e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={ui.screen}>
            <BackBar title="New group" subtitle={`${picked.length} selected`} />
            <View style={[ui.pad, { backgroundColor: '#fff' }]}>
                <TextInput style={ui.input} placeholder="Group name" value={name} onChangeText={setName} maxLength={80} />
                <TextInput style={ui.input} placeholder="Description (optional)" value={description} onChangeText={setDescription} maxLength={500} />
                {picked.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                        {picked.map((p) => (
                            <Pressable key={p.id} onPress={() => toggle(p)} style={{ alignItems: 'center', width: 60 }}>
                                <Avatar name={p.name} size={44} />
                                <Text style={ui.small} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                )}
                <View style={[ui.row, { backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14 }]}>
                    <Icon name="search" size={18} color={colors.muted} />
                    <TextInput style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: colors.ink }} placeholder="Add people" placeholderTextColor={colors.muted} value={q} onChangeText={setQ} />
                </View>
            </View>
            <FlatList
                data={people}
                keyExtractor={(p) => String(p.id)}
                style={{ backgroundColor: '#fff', flex: 1 }}
                renderItem={({ item }) => {
                    const on = picked.some((x) => x.id === item.id);
                    // Only people you can chat with straight away can be added; others need to accept a chat request first.
                    const ok = (item.reach ?? 'direct') === 'direct';
                    return <ListRow title={item.name} subtitle={ok ? [item.title, item.department].filter(Boolean).join(' · ') : 'Send them a chat request first (New chat)'} left={<Avatar name={item.name} size={44} />}
                        right={ok ? <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} color={on ? colors.leaf : colors.line} /> : <Icon name="lock-closed-outline" color={colors.line} />}
                        onPress={ok ? () => toggle(item) : undefined} />;
                }}
            />
            <View style={{ padding: 16, backgroundColor: '#fff' }}>
                <Button title="Create group" icon="checkmark" onPress={create} busy={busy} disabled={!name.trim() || !SyncEngine.online} />
            </View>
        </View>
    );
}
