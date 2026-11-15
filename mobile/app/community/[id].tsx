import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { ChatListItem } from '@/chat/ChatListItem';
import { loadCommunities } from '@/chat/communities';
import { on } from '@/lib/events';
import { Avatar, BackBar, Badge, EmptyState, Icon, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Data = Awaited<ReturnType<typeof loadCommunities>>;

export default function CommunityScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const cid = Number(id);
    const router = useRouter();
    const { me } = useAuth();
    const [data, setData] = useState<Data | null>(null);

    const load = useCallback(async () => setData(await loadCommunities()), []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => on('conversations', load), [load]);

    const c = data?.all.find((x) => x.id === cid);
    const parent = c?.parent_id ? data?.all.find((x) => x.id === c.parent_id) : null;
    const subs = data?.children(cid) ?? [];
    const groups = data?.groups(cid) ?? [];

    return (
        <View style={ui.screen}>
            <BackBar title={c?.name ?? 'Community'} subtitle={c ? `${c.member_count} members${parent ? ` · in ${parent.name}` : ''}` : null}
                avatar={c ? <Avatar name={c.name} icon="business" size={38} /> : null} />
            <ScrollView>
                {c?.description ? <Text style={[ui.text, { padding: 16, backgroundColor: '#fff' }]}>{c.description}</Text> : null}
                {groups.length > 0 && <Text style={ui.sectionTitle}>Groups you're in</Text>}
                <View style={{ backgroundColor: '#fff' }}>
                    {groups.map((g) => <ChatListItem key={g.id} item={g} meId={me?.id} onPress={() => router.push(`/chat/${g.id}`)} />)}
                </View>
                {subs.length > 0 && <Text style={ui.sectionTitle}>Communities inside</Text>}
                <View style={{ backgroundColor: '#fff' }}>
                    {subs.map((s) => (
                        <ListRow key={s.id} title={s.name} subtitle={`${s.member_count} members`} left={<Avatar name={s.name} icon="business" size={44} />}
                            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{data ? <Badge count={data.unreadIn(s.id)} color={colors.sos} /> : null}<Icon name="chevron-forward" size={18} color={colors.muted} /></View>}
                            onPress={() => router.push(`/community/${s.id}`)} />
                    ))}
                </View>
                {data && groups.length === 0 && subs.length === 0 && <EmptyState icon="people-outline" title="Nothing here for you yet" />}
                <Text style={[ui.small, { padding: 16 }]}>You're added to groups automatically from your records at the institution.</Text>
            </ScrollView>
        </View>
    );
}
