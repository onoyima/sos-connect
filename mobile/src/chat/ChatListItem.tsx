import { Text, View } from 'react-native';
import { chatTime, preview } from '@/lib/format';
import { Avatar, Badge, Icon, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

export type ChatRow = {
    id: number; type: string; auto_type: string | null; community_id: number | null; name: string; member_count: number; unread: number;
    muted: number; can_post: number; peer_json: string | null; last_message_json: string | null; last_message_at: string | null;
};

export function chatIcon(c: Pick<ChatRow, 'type' | 'auto_type'>) {
    if (c.type === 'direct') return undefined;
    switch (c.auto_type) {
        case 'announcements': return 'megaphone' as const;
        case 'course': return 'book' as const;
        case 'hostel': return 'bed' as const;
        case 'parents': return 'heart' as const;
        case 'level': return 'school' as const;
        case 'alumni': case 'alumni_year': case 'alumni_department': return 'ribbon' as const;
        default: return 'people' as const;
    }
}

export function ChatListItem({ item, meId, onPress }: { item: ChatRow; meId?: number; onPress: () => void }) {
    const last = item.last_message_json ? JSON.parse(item.last_message_json) : null;
    return (
        <ListRow
            title={item.name}
            subtitle={preview(last, last?.sender_id === meId, item.type !== 'direct')}
            left={<Avatar name={item.name} icon={chatIcon(item)} />}
            onPress={onPress}
            right={
                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                    <Text style={{ fontSize: 12, color: item.unread > 0 && !item.muted ? colors.sos : colors.muted, fontWeight: item.unread > 0 ? '700' : '400' }}>{chatTime(item.last_message_at)}</Text>
                    <View style={ui.row}>
                        {item.muted ? <Icon name="volume-mute" size={16} color={colors.muted} /> : null}
                        <Badge count={item.unread} color={item.muted ? colors.muted : colors.sos} />
                    </View>
                </View>
            }
        />
    );
}

