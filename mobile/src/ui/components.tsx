import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, ui } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

const AVATAR_COLORS = ['#1e7b57', '#2f6f8f', '#7a5c2e', '#6b4c8a', '#8a3b52', '#3d6b3d', '#2e5e7a', '#9a5b1f'];

export function initials(name: string) {
    const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Initials on a colour picked from the name, or an icon for groups and communities. */
export function Avatar({ name, size = 48, icon }: { name: string; size?: number; icon?: IconName }) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const bg = icon ? colors.mint : AVATAR_COLORS[h % AVATAR_COLORS.length];
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            {icon ? <Icon name={icon} size={size * 0.48} color={colors.leaf} /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.36 }}>{initials(name)}</Text>}
        </View>
    );
}

/** The green bar at the top of each main screen. */
export function TopBar({ title, subtitle, right, left }: { title: string; subtitle?: string | null; right?: ReactNode; left?: ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={{ backgroundColor: colors.grove, paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {left}
            <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 21, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={{ color: '#b9d6c8', fontSize: 13 }} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            <View style={ui.row}>{right}</View>
        </View>
    );
}

export function IconButton({ name, onPress, color = '#fff', label, size = 23 }: { name: IconName; onPress: () => void; color?: string; label: string; size?: number }) {
    return (
        <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} accessibilityRole="button" style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={name} color={color} size={size} />
        </Pressable>
    );
}

export function Badge({ count, color = colors.leaf }: { count: number; color?: string }) {
    if (count <= 0) return null;
    return (
        <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
        </View>
    );
}

export function Button({ title, onPress, variant = 'primary', icon, disabled, busy, style }: {
    title: string; onPress: () => void; variant?: 'primary' | 'outline' | 'danger'; icon?: IconName; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
    const base = variant === 'outline' ? ui.btnOutline : [ui.btn, variant === 'danger' && { backgroundColor: colors.sos }];
    const fg = variant === 'outline' ? colors.ink : '#fff';
    return (
        <Pressable onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [base, style, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
            {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
            <Text style={variant === 'outline' ? ui.btnOutlineText : ui.btnText}>{title}</Text>
        </Pressable>
    );
}

/** A tappable row in a list: avatar or icon on the left, two lines, something on the right. */
export function ListRow({ title, subtitle, left, right, onPress, onLongPress, danger }: {
    title: string; subtitle?: string | null; left?: ReactNode; right?: ReactNode; onPress?: () => void; onLongPress?: () => void; danger?: boolean;
}) {
    return (
        <Pressable onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed ? colors.mist : '#fff' })}>
            {left}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: danger ? colors.sos : colors.ink }} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={ui.small} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            {right}
        </Pressable>
    );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
    return (
        <View style={{ alignItems: 'center', padding: 32, gap: 10 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={30} color={colors.leaf} /></View>
            <Text style={[ui.h2, { textAlign: 'center' }]}>{title}</Text>
            {children ? <Text style={[ui.small, { textAlign: 'center' }]}>{children}</Text> : null}
        </View>
    );
}

/** Amber strip shown while there's no internet. */
export function OfflineBanner({ onPress }: { onPress?: () => void }) {
    return (
        <Pressable onPress={onPress} style={{ backgroundColor: colors.amberBg, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="cloud-offline-outline" size={18} color={colors.warn} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.ink }}>No internet. Messages go to people nearby and send when you reconnect.</Text>
            {onPress && <Icon name="chevron-forward" size={16} color={colors.warn} />}
        </Pressable>
    );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? colors.mint : colors.mist }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: active ? colors.leafDark : colors.muted }}>{label}</Text>
        </Pressable>
    );
}

export function Fab({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
    return (
        <Pressable onPress={onPress} accessibilityLabel={label} style={({ pressed }) => ({
            position: 'absolute', right: 18, bottom: 22, width: 58, height: 58, borderRadius: 18, backgroundColor: pressed ? colors.leafDark : colors.leaf,
            alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
        })}>
            <Icon name={icon} size={26} color="#fff" />
        </Pressable>
    );
}

/** Top bar for screens opened from a list: back arrow, title, optional tap target and actions. */
export function BackBar({ title, subtitle, right, onTitlePress, avatar }: { title: string; subtitle?: string | null; right?: ReactNode; onTitlePress?: () => void; avatar?: ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={{ backgroundColor: colors.grove, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconButton name="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <Pressable onPress={onTitlePress} disabled={!onTitlePress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {avatar}
                <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
                    {subtitle ? <Text style={{ color: '#b9d6c8', fontSize: 12.5 }} numberOfLines={1}>{subtitle}</Text> : null}
                </View>
            </Pressable>
            <View style={[ui.row, { gap: 4, paddingRight: 6 }]}>{right}</View>
        </View>
    );
}
