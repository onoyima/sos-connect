import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, Button, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Chat = { id: number; name: string; type: string };

/** Forward a message to up to 10 chats and groups (it arrives marked "Forwarded"). Needs internet. */
export default function ForwardScreen() {
    const { message } = useLocalSearchParams<{ message: string }>();
    const router = useRouter();
    const [chats, setChats] = useState<Chat[]>([]);
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        db().then((d) => d.getAllAsync<Chat>('SELECT id, name, type FROM conversations ORDER BY last_message_at DESC LIMIT 300')).then(setChats).catch(() => {});
    }, []);

    const list = chats.filter((c) => !q.trim() || (c.name ?? '').toLowerCase().includes(q.trim().toLowerCase()));
    const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));
    const send = async () => {
        if (!SyncEngine.online) { Alert.alert('Needs internet', 'Forwarding needs internet.'); return; }
        setBusy(true);
        try {
            const r = await api<{ sent: unknown[]; failed: { reason: string }[] }>(`/messages/${message}/forward`, { body: { conversation_ids: picked } });
            SyncEngine.run();
            Alert.alert('Forwarded', `Sent to ${r.sent.length} chat${r.sent.length === 1 ? '' : 's'}.${r.failed.length ? ` Not sent to ${r.failed.length}: ${r.failed[0].reason}` : ''}`);
            router.back();
        } catch (e) { Alert.alert('Not forwarded', (e as Error).message); }
        setBusy(false);
    };

    return (
        <View style={ui.screen}>
            <BackBar title="Forward to…" subtitle={picked.length ? `${picked.length} chosen (up to 10)` : 'Choose chats'} />
            <View style={{ padding: 12, backgroundColor: '#fff' }}>
                <TextInput value={q} onChangeText={setQ} placeholder="Search chats" style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16, color: colors.ink }} />
            </View>
            <FlatList data={list} keyExtractor={(c) => String(c.id)} renderItem={({ item }) => {
                const on = picked.includes(item.id);
                return (
                    <Pressable onPress={() => toggle(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: on ? colors.mint : '#fff' }}>
                        <Avatar name={item.name ?? 'Chat'} size={42} />
                        <Text style={{ flex: 1, fontSize: 16, color: colors.ink }} numberOfLines={1}>{item.name}</Text>
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? colors.leaf : colors.line, backgroundColor: on ? colors.leaf : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <Icon name="checkmark" size={14} color="#fff" />}
                        </View>
                    </Pressable>
                );
            }} />
            <View style={{ padding: 12, backgroundColor: '#fff' }}>
                <Button title={busy ? 'Forwarding…' : picked.length ? `Forward to ${picked.length}` : 'Choose chats'} onPress={send} disabled={!picked.length || busy} />
            </View>
        </View>
    );
}
