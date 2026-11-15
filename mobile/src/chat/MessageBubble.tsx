import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, Text, View } from 'react-native';
import { splitMentions } from './mentions';
import { authHeaders, cachedFile, fileUrl, openFile } from '@/lib/files';
import { clock, duration, fileSize } from '@/lib/format';
import { useCalls } from '@/calls/CallContext';
import { StickerView } from './StickerPanel';
import { Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

export type Msg = {
    client_id: string; id: number | null; sender_id: number; sender_name: string; type: string; body: string | null; meta: string | null;
    via: string; sent_at: string; state: string; deleted: number;
    reply_to_json?: string | null; mentions_json?: string | null; edited?: number;
};

type QuoteT = { id: number; sender_id: number; sender_name?: string | null; type: string; body: string | null; deleted?: boolean };
type MentionT = { id: number; name: string };

/** Text with @mentions in bold green; mentions of me get a soft highlight. */
export function MentionText({ body, mentions, meId }: { body: string; mentions: MentionT[]; meId?: number }) {
    return (
        <Text style={ui.text}>
            {splitMentions(body, mentions).map((p, k) => p.mention
                ? <Text key={k} style={{ fontWeight: '700', color: colors.leafDark, backgroundColor: p.mention.id === meId ? colors.amberBg : undefined }}>{p.text}</Text>
                : p.text)}
        </Text>
    );
}

export function quoteText(q: { type: string; body: string | null; deleted?: boolean | number }) {
    if (q.deleted) return 'Deleted message';
    return q.type === 'sticker' ? `Sticker${q.body ? ` · ${q.body}` : ''}` : q.type === 'image' ? `Photo${q.body ? ` · ${q.body}` : ''}` : q.type === 'voice' ? 'Voice note' : q.type === 'file' ? q.body ?? 'File' : q.body ?? '';
}

type Meta = {
    path?: string; size?: number | null; duration?: number | null; local_uri?: string; mime?: string; legacy_url?: string;
    call?: { uuid: string; type: 'voice' | 'video'; ended?: boolean; duration_s?: number };
    sticker?: string;
    status_reply?: { preview?: string; media_path?: string | null; background?: string | null };
} | null;

let headersCache: Record<string, string> | null = null;
function useHeaders() {
    const [h, setH] = useState(headersCache);
    useEffect(() => { if (!h) authHeaders().then((x) => { headersCache = x; setH(x); }); }, [h]);
    return h;
}

/** Tick marks: clock while sending, one tick sent, antenna when it went to phones nearby, red when it failed. */
function StateIcon({ state }: { state: string }) {
    if (state === 'pending' || state === 'queued') return <Icon name="time-outline" size={13} color={colors.muted} />;
    if (state === 'mesh') return <Icon name="radio-outline" size={13} color={colors.leaf} />;
    if (state === 'failed') return <Icon name="alert-circle" size={13} color={colors.sos} />;
    return <Icon name="checkmark-done" size={15} color={colors.leaf} />;
}

export function MessageBubble({ m, mine, showName, onLongPress, onQuotePress, meId, flash }: {
    m: Msg; mine: boolean; showName: boolean; onLongPress: () => void; onQuotePress?: (id: number) => void; meId?: number; flash?: boolean;
}) {
    const meta: Meta = m.meta ? JSON.parse(m.meta) : null;
    const quote: QuoteT | null = m.reply_to_json ? JSON.parse(m.reply_to_json) : null;
    const mentions: MentionT[] = m.mentions_json ? JSON.parse(m.mentions_json) : [];
    if (m.type === 'system') return <SystemNote m={m} meta={meta} meId={meId} />;
    const isSticker = m.type === 'sticker' && !m.deleted;
    return (
        <Pressable onLongPress={onLongPress} delayLongPress={350}
            style={{
                alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: isSticker ? 'transparent' : mine ? colors.mint : '#fff',
                borderRadius: 16, borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4,
                paddingHorizontal: 10, paddingTop: 7, paddingBottom: 5, marginVertical: 1.5,
                shadowColor: '#000', shadowOpacity: isSticker ? 0 : 0.04, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: isSticker ? 0 : 1,
                borderWidth: flash ? 2 : 0, borderColor: colors.amber,
            }}>
            {showName && !mine && <Text style={{ fontSize: 13, fontWeight: '700', color: colors.leaf, marginBottom: 2 }}>{m.sender_name}</Text>}
            {quote && !m.deleted && (
                <Pressable onPress={() => onQuotePress?.(quote.id)} style={{ backgroundColor: 'rgba(14,59,46,0.07)', borderLeftWidth: 4, borderLeftColor: colors.leaf, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.leaf }}>{quote.sender_id === meId ? 'You' : quote.sender_name}</Text>
                    <Text style={ui.small} numberOfLines={2}>{quoteText(quote)}</Text>
                </Pressable>
            )}
            {meta?.status_reply && !m.deleted && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(14,59,46,0.07)', borderLeftWidth: 4, borderLeftColor: colors.leaf, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 4 }}>
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.leaf }}>{mine ? 'You replied to their status' : 'Replied to your status'}</Text>
                        <Text style={ui.small} numberOfLines={2}>{meta.status_reply.preview}</Text>
                    </View>
                    <View style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: meta.status_reply.background ?? colors.grove }} />
                </View>
            )}
            {m.deleted ? (
                <Text style={[ui.text, { fontStyle: 'italic', color: colors.muted }]}>This message was deleted</Text>
            ) : m.type === 'sticker' ? (
                <StickerView id={meta?.sticker} />
            ) : m.type === 'image' ? (
                <ImageBody meta={meta} caption={m.body} />
            ) : m.type === 'voice' ? (
                <VoiceBody meta={meta} />
            ) : m.type === 'file' ? (
                <FileBody meta={meta} name={m.body ?? 'File'} />
            ) : (
                <MentionText body={m.body ?? ''} mentions={mentions} meId={meId} />
            )}
            {meta?.legacy_url && !m.deleted ? <Text style={{ color: colors.leaf, fontSize: 13, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(meta.legacy_url!)}>Open the original file</Text> : null}
            <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
                {m.via !== 'online' && !mine && <Icon name="radio-outline" size={12} color={colors.muted} />}
                {m.edited ? <Text style={{ fontSize: 11, color: colors.muted }}>edited</Text> : null}
                {mine && m.state === 'queued' && m.type !== 'text' ? <Text style={{ fontSize: 11, color: colors.warn }}>waits for internet</Text> : null}
                <Text style={{ fontSize: 11, color: colors.muted }}>{clock(m.sent_at)}</Text>
                {mine && <StateIcon state={m.state} />}
            </View>
        </Pressable>
    );
}

function ImageBody({ meta, caption }: { meta: Meta; caption: string | null }) {
    const headers = useHeaders();
    const [open, setOpen] = useState(false);
    const uri = meta?.path ? fileUrl(meta.path) : meta?.local_uri;
    const source = meta?.path ? (headers ? { uri, headers } : null) : uri ? { uri } : null;
    return (
        <View style={{ gap: 6 }}>
            <Pressable onPress={() => source && setOpen(true)}>
                {source ? <Image source={source} style={{ width: 240, height: 240, borderRadius: 12, backgroundColor: colors.mist }} resizeMode="cover" />
                    : <View style={{ width: 240, height: 240, borderRadius: 12, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.leaf} /></View>}
            </Pressable>
            {caption ? <Text style={ui.text}>{caption}</Text> : null}
            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' }}>
                    {source && <Image source={source} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
                    {caption ? <Text style={{ color: '#fff', textAlign: 'center', padding: 16 }}>{caption}</Text> : null}
                </Pressable>
            </Modal>
        </View>
    );
}

function FileBody({ meta, name }: { meta: Meta; name: string }) {
    const [busy, setBusy] = useState(false);
    const open = async () => {
        if (!meta?.path) return;
        setBusy(true);
        try { await openFile(meta.path, name); } finally { setBusy(false); }
    };
    return (
        <Pressable onPress={open} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(14,59,46,0.06)', borderRadius: 12, padding: 10, minWidth: 220 }}>
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.leaf, alignItems: 'center', justifyContent: 'center' }}>
                {busy ? <ActivityIndicator color="#fff" /> : <Icon name="document-text" color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }} numberOfLines={2}>{name}</Text>
                <Text style={ui.small}>{[fileSize(meta?.size), meta?.path ? 'Tap to open' : 'Uploading…'].filter(Boolean).join(' · ')}</Text>
            </View>
        </Pressable>
    );
}

function VoiceBody({ meta }: { meta: Meta }) {
    const [uri, setUri] = useState<string | null>(meta?.local_uri ?? null);
    const player = useAudioPlayer(uri ? { uri } : null);
    const status = useAudioPlayerStatus(player);
    const [loading, setLoading] = useState(false);
    const [rate, setRate] = useState(1);
    const [playWhenReady, setPlayWhenReady] = useState(false);

    // Downloaded on the first tap, then plays straight away (no second tap).
    useEffect(() => {
        if (!playWhenReady || !uri || !status.isLoaded) return;
        setPlayWhenReady(false);
        setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).then(() => player.play());
    }, [playWhenReady, uri, status.isLoaded]);

    const toggle = async () => {
        if (!uri && meta?.path) {
            setLoading(true);
            try { setUri(await cachedFile(meta.path)); setPlayWhenReady(true); } finally { setLoading(false); }
            return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        if (status.playing) player.pause();
        else {
            if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1)) await player.seekTo(0);
            player.play();
        }
    };
    const cycleRate = () => {
        const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
        setRate(next);
        player.setPlaybackRate(next);
    };
    const total = status.duration || meta?.duration || 0;
    const progress = total ? Math.min(1, status.currentTime / total) : 0;

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, paddingVertical: 2 }}>
            <Pressable onPress={toggle} hitSlop={8} accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.leaf, alignItems: 'center', justifyContent: 'center' }}>
                {loading ? <ActivityIndicator color="#fff" /> : <Icon name={status.playing ? 'pause' : 'play'} color="#fff" size={20} />}
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line }}>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.leaf, width: `${progress * 100}%` }} />
                </View>
                <Text style={ui.small}>{duration(status.playing || status.currentTime > 0 ? status.currentTime : total)}</Text>
            </View>
            <Pressable onPress={cycleRate} hitSlop={8} accessibilityLabel="Playback speed" style={{ backgroundColor: 'rgba(14,59,46,0.08)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{rate}x</Text>
            </Pressable>
        </View>
    );
}

/** A notice in the chat, e.g. a group call card with Join while the call is running. */
function SystemNote({ m, meta, meId }: { m: Msg; meta: Meta; meId?: number }) {
    const calls = useCalls();
    const call = meta?.call;
    if (!call) {
        return <Text style={{ alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.9)', color: colors.muted, fontSize: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, marginVertical: 8, overflow: 'hidden' }}>{m.body}</Text>;
    }
    const mins = call.duration_s ? Math.max(1, Math.round(call.duration_s / 60)) : null;
    return (
        <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, maxWidth: '92%' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: call.ended ? colors.mist : colors.leaf, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={call.type === 'video' ? 'videocam' : 'call'} size={17} color={call.ended ? colors.muted : '#fff'} />
            </View>
            <View style={{ flexShrink: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{call.type === 'video' ? 'Video' : 'Voice'} call{call.ended ? ' ended' : ''}</Text>
                <Text style={ui.small}>{m.sender_id === meId ? 'You' : m.sender_name} started it · {clock(m.sent_at)}{mins ? ` · ${mins} min` : ''}</Text>
            </View>
            {!call.ended && (
                <Pressable onPress={() => calls.joinGroup(call.uuid).catch((e) => Alert.alert('Call', (e as Error).message))}
                    style={{ backgroundColor: colors.leaf, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Join</Text>
                </Pressable>
            )}
        </View>
    );
}
