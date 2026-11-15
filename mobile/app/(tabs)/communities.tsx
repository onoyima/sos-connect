import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { loadCommunities } from '@/chat/communities';
import { on } from '@/lib/events';
import { Avatar, Badge, EmptyState, Icon, ListRow, TopBar } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Data = Awaited<ReturnType<typeof loadCommunities>>;

/**
 * University → faculty → department communities, each with its groups (announcements, general, students or staff,
 * levels, courses). People only see the ones they belong to; joining happens automatically from their records.
 */
export default function Communities() {
    const router = useRouter();
    const { me } = useAuth();
    const [data, setData] = useState<Data | null>(null);

    const load = useCallback(async () => setData(await loadCommunities()), []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => on('conversations', load), [load]);

    return (
        <View style={ui.screen}>
            <TopBar title="Communities" subtitle={me?.institution?.name} />
            <ScrollView>
                {data && data.all.length === 0 && (
                    <EmptyState icon="people-outline" title="No communities yet">Your university, faculty and department communities appear here after your first sync.</EmptyState>
                )}
                {data?.top.map((c) => {
                    const groups = data.groups(c.id).slice(0, 4);
                    const subs = data.children(c.id);
                    return (
                        <View key={c.id} style={{ backgroundColor: '#fff', marginBottom: 10 }}>
                            <ListRow title={c.name} subtitle={c.description ?? `${c.member_count} members`}
                                left={<Avatar name={c.name} icon="business" size={52} />} onPress={() => router.push(`/community/${c.id}`)}
                                right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Badge count={data.unreadIn(c.id)} color={colors.sos} /><Icon name="chevron-forward" size={18} color={colors.muted} /></View>} />
                            {groups.map((g) => (
                                <ListRow key={g.id} title={g.name} subtitle={g.auto_type === 'announcements' ? 'Notices' : `${g.member_count} members`}
                                    left={<View style={{ width: 52, alignItems: 'center' }}><Icon name={g.auto_type === 'announcements' ? 'megaphone-outline' : 'chatbubbles-outline'} color={colors.leaf} /></View>}
                                    right={<Badge count={g.unread} color={g.muted ? colors.muted : colors.sos} />} onPress={() => router.push(`/chat/${g.id}`)} />
                            ))}
                            {(subs.length > 0 || data.groups(c.id).length > 4) && (
                                <Text onPress={() => router.push(`/community/${c.id}`)} style={{ color: colors.leaf, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 12, paddingLeft: 82 }}>
                                    {subs.length > 0 ? `${subs.length} more ${subs.length === 1 ? 'community' : 'communities'} inside` : 'See all groups'}
                                </Text>
                            )}
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}
