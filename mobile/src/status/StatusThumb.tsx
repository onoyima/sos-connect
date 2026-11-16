import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { authHeaders, fileUrl } from '@/lib/files';
import { Icon } from '@/ui/components';
import { STATUS_COLORS, type Status } from './status';

/** A round preview of someone's newest status: the photo or GIF itself, or the colour and text of a text update. */
export function StatusThumb({ s, size = 56 }: { s: Status | undefined; size?: number }) {
    const [headers, setHeaders] = useState<Record<string, string> | null>(null);
    useEffect(() => { authHeaders().then(setHeaders).catch(() => setHeaders({})); }, []);
    const box = { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const };
    if (!s) return <View style={[box, { backgroundColor: STATUS_COLORS[0] }]} />;

    const kind = s.media_type ?? (s.media_path ? 'image' : null);
    if (s.media_path && (kind === 'image' || kind === 'gif') && headers) {
        return <Image source={{ uri: fileUrl(s.media_path), headers }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />;
    }
    const bg = s.background ?? (kind === 'video' ? '#1b2a24' : STATUS_COLORS[0]);
    return (
        <View style={[box, { backgroundColor: bg }]}>
            {kind === 'video' ? <Icon name="play" size={size * 0.4} color="#fff" />
                : kind === 'audio' ? <Icon name="musical-notes" size={size * 0.4} color="#fff" />
                : <Text numberOfLines={2} style={{ color: '#fff', fontSize: Math.max(8, size / 6), fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 }}>{(s.body ?? '').slice(0, 24)}</Text>}
        </View>
    );
}
