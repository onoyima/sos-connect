import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kvGet, kvSet } from '@/db/database';
import { Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';
import { EMOJI_GROUPS, STICKERS, stickerById } from './stickers';

/** How a sticker looks in the chat and in the panel. */
export function StickerView({ id, small = false }: { id?: string | null; small?: boolean }) {
    const st = stickerById(id);
    if (!st) return <Text style={[ui.small, { fontStyle: 'italic' }]}>Sticker</Text>;
    const size = small ? 96 : 140;
    return (
        <View accessibilityRole="image" accessibilityLabel={`Sticker: ${st.label}`}
            style={{ width: size, height: size, borderRadius: 26, backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Text style={{ fontSize: small ? 38 : 58 }}>{st.emoji}</Text>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
                <Text style={{ color: st.fg, fontWeight: '800', fontSize: small ? 11 : 13 }} numberOfLines={1}>{st.label}</Text>
            </View>
        </View>
    );
}

/**
 * Emojis and stickers. Emojis go into the message; a sticker is sent at once. (Phone keyboards have emojis too;
 * this panel adds recent ones and the sticker set.)
 */
export function StickerPanel({ visible, onClose, onEmoji, onSticker, stickers = true }: { visible: boolean; onClose: () => void; onEmoji: (e: string) => void; onSticker: (id: string) => void; stickers?: boolean }) {
    const insets = useSafeAreaInsets();
    const [chosen, setTab] = useState<'emoji' | 'sticker'>('sticker');
    const tab = stickers ? chosen : 'emoji';
    const [group, setGroup] = useState(0);
    const [recent, setRecent] = useState<string[]>([]);

    const loadRecent = async () => setRecent((await kvGet<string[]>('recent_emoji')) ?? []);
    const pick = async (e: string) => {
        const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
        setRecent(next);
        kvSet('recent_emoji', next).catch(() => {});
        onEmoji(e);
    };
    const list = group === -1 ? recent : EMOJI_GROUPS[group]?.list ?? [];

    return (
        <Modal visible={visible} transparent animationType="slide" onShow={loadRecent} onRequestClose={onClose}>
            <Pressable style={{ flex: 1 }} onPress={onClose} />
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom + 6, maxHeight: '55%',
                shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                    {(stickers ? (['sticker', 'emoji'] as const) : (['emoji'] as const)).map((t) => (
                        <Pressable key={t} onPress={() => setTab(t)} style={{ backgroundColor: tab === t ? colors.mint : 'transparent', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
                            <Text style={{ fontWeight: '700', color: tab === t ? colors.grove : colors.muted }}>{t === 'sticker' ? 'Stickers' : 'Emoji'}</Text>
                        </Pressable>
                    ))}
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10}><Icon name="close" color={colors.muted} /></Pressable>
                </View>
                {tab === 'sticker' ? (
                    <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12, justifyContent: 'center' }}>
                        {STICKERS.map((s) => (
                            <Pressable key={s.id} onPress={() => onSticker(s.id)} accessibilityLabel={`Send sticker: ${s.label}`} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                                <StickerView id={s.id} small />
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : (
                    <>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 6, gap: 2 }}>
                            {recent.length > 0 && (
                                <Pressable onPress={() => setGroup(-1)} style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: group === -1 ? colors.mist : 'transparent' }}>
                                    <Icon name="time-outline" color={colors.muted} size={20} />
                                </Pressable>
                            )}
                            {EMOJI_GROUPS.map((g, i) => (
                                <Pressable key={g.name} onPress={() => setGroup(i)} accessibilityLabel={g.name}
                                    style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: group === i ? colors.mist : 'transparent' }}>
                                    <Text style={{ fontSize: 22 }}>{g.icon}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8 }}>
                            {list.map((e, i) => (
                                <Pressable key={`${e}-${i}`} onPress={() => pick(e)} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ fontSize: 27 }}>{e}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </>
                )}
            </View>
        </Modal>
    );
}
