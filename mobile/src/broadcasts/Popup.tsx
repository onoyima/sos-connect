import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { on } from '@/lib/events';
import { Icon } from '@/ui/components';
import { colors } from '@/ui/theme';
import { refreshBroadcasts, type BroadcastItem } from './store';

const HEAD = { info: colors.grove, urgent: colors.sos, celebration: '#7a3fd1' } as const;
const AWAY_MS = 10 * 60_000;

/**
 * Pop-ups from the institution: shown every time the app is opened (or comes back after 10 minutes away), until
 * the sender pauses them. Never in the middle of using the app.
 */
export function BroadcastPopup({ ready }: { ready: boolean }) {
    const [queue, setQueue] = useState<BroadcastItem[]>([]);
    const leftAt = useRef<number | null>(null);

    useEffect(() => {
        if (!ready) return;
        refreshBroadcasts().then(setQueue);
        const sub = AppState.addEventListener('change', (s) => {
            if (s === 'background') leftAt.current = Date.now();
            if (s === 'active') {
                const away = leftAt.current !== null && Date.now() - leftAt.current > AWAY_MS;
                refreshBroadcasts().then((p) => { if (away) setQueue(p); });
                leftAt.current = null;
            }
        });
        // Something was paused or deleted: take it away at once.
        const off = on('broadcasts', () => {});
        return () => { sub.remove(); off(); };
    }, [ready]);

    const item = queue[0];
    if (!item) return null;
    const close = () => setQueue((q) => q.slice(1));
    const open = () => {
        close();
        if (item.link_url) (item.link_url.startsWith('/') ? router.push(item.link_url as never) : Linking.openURL(item.link_url));
    };
    return (
        <Modal transparent animationType="fade" onRequestClose={close} visible>
            <View style={{ flex: 1, backgroundColor: 'rgba(14,59,46,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <View style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden' }}>
                    <View style={{ backgroundColor: HEAD[item.style], padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Icon name={item.style === 'urgent' ? 'warning' : item.style === 'celebration' ? 'sparkles' : 'megaphone'} color="#fff" size={22} />
                        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 }}>{item.title || 'Message from your institution'}</Text>
                    </View>
                    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 16 }}>
                        <Text style={{ fontSize: 15.5, color: colors.ink, lineHeight: 22 }}>{item.body}</Text>
                    </ScrollView>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 14, borderTopWidth: 1, borderColor: colors.line }}>
                        {queue.length > 1 && <Text style={{ marginRight: 'auto', alignSelf: 'center', color: colors.muted, fontSize: 12 }}>{queue.length - 1} more</Text>}
                        {item.link_url && <Pressable onPress={open} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}><Text style={{ fontWeight: '700', color: colors.ink }}>{item.link_label || 'Open'}</Text></Pressable>}
                        <Pressable onPress={close} style={{ backgroundColor: colors.leaf, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 9 }}><Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text></Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}
