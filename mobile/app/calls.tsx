import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { useCalls } from '@/calls/CallContext';
import { api } from '@/lib/api';
import { chatTime } from '@/lib/format';
import { refreshBadges } from '@/sync/realtime';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, BackBar, EmptyState, Icon, IconButton } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Call = {
    call_uuid: string; type: 'voice' | 'video'; status: string; via: string; direction: string; other: { id: number; name: string } | null;
    group?: { conversation_id: number; name: string }; started_at: string; duration_s: number | null;
};

const length = (s: number) => (s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min`);

/** Call history: missed calls in red, call back with one tap. Opening it clears the missed-call count. */
export default function Calls() {
    const { can, has } = useAuth();
    const calls = useCalls();
    const [list, setList] = useState<Call[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!SyncEngine.online) return;
        const r = await api<{ calls: Call[] }>('/calls').catch(() => null);
        if (r) setList(r.calls);
        api('/calls/seen', { method: 'POST' }).then(refreshBadges).catch(() => {});
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const again = (c: Call, type: 'voice' | 'video') => {
        const run = c.group ? calls.startGroup(c.group.conversation_id, type) : c.other ? calls.start(c.other, type) : null;
        run?.catch((e) => Alert.alert('Call', (e as Error).message));
    };

    return (
        <View style={ui.screen}>
            <BackBar title="Calls" subtitle={SyncEngine.online ? null : 'Needs internet'} />
            <FlatList
                data={list}
                keyExtractor={(c) => c.call_uuid}
                style={{ backgroundColor: '#fff' }}
                refreshControl={<RefreshControl colors={[colors.leaf]} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                ListEmptyComponent={<EmptyState icon="call-outline" title="No calls yet">Call someone from the phone or camera button at the top of a chat.</EmptyState>}
                renderItem={({ item: c }) => {
                    const missed = c.status === 'missed' && c.direction === 'incoming';
                    const name = c.group?.name ?? c.other?.name ?? 'Former member';
                    const what = c.group ? `Group ${c.type} call` : missed ? `Missed ${c.type} call` : `${c.direction === 'incoming' ? 'Incoming' : 'Outgoing'} ${c.type} call`;
                    return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                            <Avatar name={name} size={44} icon={c.group ? 'people' : undefined} />
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '700', fontSize: 16, color: missed ? colors.sos : colors.ink }} numberOfLines={1}>{name}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Icon name={missed ? 'arrow-down' : c.direction === 'incoming' ? 'arrow-down' : 'arrow-up'} size={14} color={missed ? colors.sos : colors.leaf} />
                                    <Text style={[ui.small, missed && { color: colors.sos }]} numberOfLines={1}>{what} · {chatTime(c.started_at)}{c.duration_s ? ` · ${length(c.duration_s)}` : ''}</Text>
                                </View>
                            </View>
                            {has('voice_calls') && can('calls.voice') && <IconButton name="call-outline" label="Voice call" color={colors.leaf} onPress={() => again(c, 'voice')} />}
                            {has('video_calls') && can('calls.video') && <IconButton name="videocam-outline" label="Video call" color={colors.leaf} onPress={() => again(c, 'video')} />}
                        </View>
                    );
                }}
            />
        </View>
    );
}
