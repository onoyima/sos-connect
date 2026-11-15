import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { SyncEngine } from '@/sync/SyncEngine';
import type { ChatRow } from './ChatListItem';

/** Mute (8 hours, a week, always), archive and pause for one chat, from a long press or the chat's menu. */
export function chatOptions(c: ChatRow, has: (m: string) => boolean, after?: () => void) {
    const set = async (body: Record<string, unknown>) => {
        try {
            await api(`/conversations/${c.id}`, { method: 'PATCH', body });
            await SyncEngine.refreshConversations();
            after?.();
        } catch (e) { Alert.alert('Not done', (e as Error).message); }
    };
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (has('mute_chats')) {
        if (c.muted) buttons.push({ text: 'Unmute', onPress: () => set({ muted: false }) });
        else {
            buttons.push({ text: 'Mute for 8 hours', onPress: () => set({ muted: true, mute_hours: 8 }) });
            buttons.push({ text: 'Mute for 1 week', onPress: () => set({ muted: true, mute_hours: 168 }) });
            buttons.push({ text: 'Mute always', onPress: () => set({ muted: true, mute_hours: null }) });
        }
    }
    if (has('archive_chats')) buttons.push({ text: c.archived ? 'Unarchive' : 'Archive', onPress: () => set({ archived: !c.archived }) });
    if (has('pause_chats')) buttons.push(c.paused_after != null
        ? { text: 'Resume messages', onPress: () => set({ paused: false }) }
        : { text: 'Pause messages', onPress: () => set({ paused: true }) });
    if (!buttons.length) return;
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(c.name, c.paused_after != null ? 'Paused: new messages are held back until you resume.' : undefined, buttons);
}
