import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { db } from '@/db/database';
import { on } from '@/lib/events';
import { currentBadges } from '@/sync/realtime';
import { Icon, type IconName } from '@/ui/components';
import { colors } from '@/ui/theme';

const icon = (name: IconName, active: IconName) => ({ color, focused }: { color: string; focused: boolean }) => <Icon name={focused ? active : name} color={color} size={24} />;

/** Chats, Communities, SOS, Updates, Me. Admin work (roles, structure, settings) stays on the website. */
export default function TabsLayout() {
    const { has, can } = useAuth();
    const insets = useSafeAreaInsets();
    const [unread, setUnread] = useState(0);
    const [inCommunities, setInCommunities] = useState(0);
    const [requests, setRequests] = useState(currentBadges().requests);

    // Red counts: chats with unread messages (plus chat requests), and unread groups inside communities.
    useEffect(() => {
        const load = async () => {
            const d = await db();
            const r = await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM conversations WHERE unread > 0 AND muted = 0');
            const c = await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM conversations WHERE unread > 0 AND muted = 0 AND community_id IS NOT NULL');
            setUnread(r?.n ?? 0);
            setInCommunities(c?.n ?? 0);
        };
        load();
        const a = on('conversations', load);
        const b = on('messages', load);
        const c = on('badges', (x) => setRequests(x.requests));
        return () => { a(); b(); c(); };
    }, []);

    const chat = can('chat.use');
    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.leafDark,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: { height: 62 + insets.bottom, paddingTop: 6, borderTopColor: colors.line },
            tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        }}>
            <Tabs.Screen name="index" options={{ title: 'Chats', tabBarIcon: icon('chatbubbles-outline', 'chatbubbles'), tabBarBadge: unread + requests || undefined, tabBarBadgeStyle: { backgroundColor: colors.sos }}} />
            <Tabs.Screen name="communities" options={{ title: 'Communities', tabBarIcon: icon('people-outline', 'people'), href: chat && has('communities') ? undefined : null,
                tabBarBadge: inCommunities || undefined, tabBarBadgeStyle: { backgroundColor: colors.sos } }} />
            <Tabs.Screen name="sos" options={{
                title: 'SOS',
                tabBarIcon: () => (
                    <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.sos, alignItems: 'center', justifyContent: 'center', marginTop: -14, borderWidth: 3, borderColor: '#fff' }}>
                        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>SOS</Text>
                    </View>
                ),
                tabBarLabel: () => null,
            }} />
            <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarIcon: icon('newspaper-outline', 'newspaper') }} />
            <Tabs.Screen name="settings" options={{ title: 'Me', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
        </Tabs>
    );
}
