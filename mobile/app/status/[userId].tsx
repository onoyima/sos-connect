import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { authHeaders, cachedFile, fileUrl } from '@/lib/files';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { chatTime } from '@/lib/format';
import { cachedStatuses, fetchStatuses, group, patchCached, STATUS_COLORS, type Comment, type Reactions, type Status } from '@/status/status';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, Icon, IconButton } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

const SECONDS = 7;
const AUDIENCE: Record<string, string> = { contacts: 'people you chatted with', department: 'my department', faculty: 'my faculty', groups: 'chosen groups', selected: 'chosen people', institution: 'the whole institution' };

/**
 * Full-screen status viewer: tap right for next, left for previous, hold to pause; moves on by itself.
 * Like or love it, read and write comments (and reply to a comment), or reply privately to the poster.
 */
export default function StatusViewer() {
    const { userId } = useLocalSearchParams<{ userId: string }>();
    const uid = Number(userId);
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { me, has } = useAuth();
    const interact = has('status_interactions');
    const [list, setList] = useState<Status[]>(() => pick(cachedStatuses(), uid, me?.id ?? 0));
    const [loading, setLoading] = useState(list.length === 0);
    const [i, setI] = useState(() => Math.max(0, list.findIndex((s) => !s.viewed)));
    const [elapsed, setElapsed] = useState(0);
    const [headers, setHeaders] = useState<Record<string, string> | null>(null);
    const [sheet, setSheet] = useState<null | 'comments' | 'viewers'>(null);
    const [reply, setReply] = useState('');
    const [held, setHeld] = useState(false);
    const typing = reply.length > 0;
    const paused = held || sheet !== null || typing;
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const s = list[i];
    const mine = s?.user.id === me?.id;
    // Videos and audio play to the end (their own length), then move on.
    const playable = !!s?.media_path && (s.media_type === 'video' || s.media_type === 'audio');
    const playableRef = useRef(playable);
    playableRef.current = playable;
    const [total, setTotal] = useState(SECONDS);

    // Opened from a notification: the list may not be loaded yet.
    useEffect(() => {
        if (list.length || !me) return;
        if (!SyncEngine.online) { setLoading(false); return; }
        fetchStatuses(me.id).then(() => {
            const found = pick(cachedStatuses(), uid, me.id);
            setList(found);
            setI(Math.max(0, found.findIndex((x) => !x.viewed)));
        }).finally(() => setLoading(false));
    }, []);
    useEffect(() => { authHeaders().then(setHeaders); }, []);

    useEffect(() => {
        if (!s) return;
        setElapsed(0);
        setTotal(SECONDS);
        setReply('');
        if (!mine && !s.viewed) {
            api(`/status/${s.id}/view`, { method: 'POST' }).catch(() => {});
            update(s.id, { viewed: true });
        }
        const t = setInterval(() => !pausedRef.current && !playableRef.current && setElapsed((e) => e + 0.1), 100);
        return () => clearInterval(t);
    }, [s?.id]);
    useEffect(() => { if (!playable && elapsed >= SECONDS) next(); }, [elapsed]);

    const update = (id: number, patch: Partial<Status>) => {
        patchCached(id, patch);
        setList((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    };
    const next = () => (i + 1 < list.length ? setI(i + 1) : router.back());
    const prev = () => (i > 0 ? setI(i - 1) : setElapsed(0));

    if (loading) return <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
    if (!s) {
        return (
            <View style={{ flex: 1, backgroundColor: colors.grove, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
                <Text style={{ color: '#fff', fontSize: 17, textAlign: 'center' }}>{SyncEngine.online ? 'This status has expired or was deleted.' : 'Status needs internet.'}</Text>
                <Pressable onPress={() => router.back()} style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 }}><Text style={{ fontWeight: '700', color: colors.grove }}>Go back</Text></Pressable>
            </View>
        );
    }
    const bg = s.background ?? STATUS_COLORS[s.id % STATUS_COLORS.length];
    const reactions: Reactions = s.reactions ?? { like: 0, love: 0 };

    const react = async (r: 'like' | 'love') => {
        const want = s.my_reaction === r ? null : r;
        const before = { reactions, my_reaction: s.my_reaction ?? null };
        const counts = { ...reactions };
        if (s.my_reaction) counts[s.my_reaction] = Math.max(0, counts[s.my_reaction] - 1);
        if (want) counts[want] += 1;
        update(s.id, { my_reaction: want, reactions: counts });
        try {
            const res = await api<{ reactions: Reactions; my_reaction: Status['my_reaction'] }>(`/status/${s.id}/react`, { body: { reaction: want } });
            update(s.id, res);
        } catch (e) { update(s.id, before); Alert.alert('Not saved', (e as Error).message); }
    };

    const sendReply = async () => {
        const text = reply.trim();
        if (!text) return;
        try {
            const r = await api<{ conversation_id: number }>(`/status/${s.id}/reply`, { body: { body: text } });
            setReply('');
            SyncEngine.run();
            Alert.alert('Sent', `Your reply went to ${s.user.name}.`, [{ text: 'OK' }, { text: 'Open chat', onPress: () => router.replace(`/chat/${r.conversation_id}`) }]);
        } catch (e) { Alert.alert('Not sent', (e as Error).message); }
    };

    const remove = () => Alert.alert('Delete this status?', 'It disappears for everyone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => api(`/status/${s.id}`, { method: 'DELETE' }).then(() => router.back()).catch((e) => Alert.alert('Not deleted', e.message)) },
    ]);

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: s.media_path ? '#000' : bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ position: 'absolute', top: insets.top + 6, left: 8, right: 8, zIndex: 2, gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                    {list.map((x, k) => (
                        <View key={x.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }}>
                            <View style={{ height: 3, borderRadius: 2, backgroundColor: '#fff', width: `${k < i ? 100 : k === i ? Math.min(100, (elapsed / total) * 100) : 0}%` }} />
                        </View>
                    ))}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <IconButton name="arrow-back" label="Close" onPress={() => router.back()} />
                    <Avatar name={s.user.name} size={36} />
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '700' }} numberOfLines={1}>{mine ? 'My status' : s.user.name}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }} numberOfLines={1}>{chatTime(s.created_at)}{mine && s.audience ? ` · shared with ${AUDIENCE[s.audience] ?? s.audience}` : ''}</Text>
                    </View>
                    {mine && <IconButton name="trash-outline" label="Delete status" onPress={remove} />}
                </View>
            </View>

            <Pressable style={{ flex: 1, justifyContent: 'center' }} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={250}
                onPress={(e) => (e.nativeEvent.locationX < 120 ? prev() : next())}>
                {s.media_path && headers && s.media_type === 'video'
                    ? <StatusVideo key={s.id} uri={fileUrl(s.media_path)} headers={headers} paused={paused} onTime={(t, d) => { setElapsed(t); if (d) setTotal(d); }} onEnd={next} />
                    : s.media_path && s.media_type === 'audio'
                        ? <StatusAudio key={s.id} path={s.media_path} paused={paused} onTime={(t, d) => { setElapsed(t); if (d) setTotal(d); }} onEnd={next} />
                        : s.media_path && headers ? <Image source={{ uri: fileUrl(s.media_path), headers }} style={{ width: '100%', height: '70%' }} resizeMode="contain" /> : null}
                {s.body ? (
                    <Text style={s.media_path
                        ? { color: '#fff', fontSize: 16, textAlign: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.4)' }
                        : { color: '#fff', fontSize: 26, fontWeight: '600', textAlign: 'center', paddingHorizontal: 28, lineHeight: 34 }}>{s.body}</Text>
                ) : null}
                {s.mentions?.length ? <Text style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: 10, paddingHorizontal: 20 }}>With {s.mentions.map((m) => (m.id === me?.id ? 'you' : m.name)).join(', ')}</Text> : null}
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: insets.bottom + 10, backgroundColor: 'rgba(0,0,0,0.25)' }}>
                {mine ? (
                    <>
                        <Chip icon="eye-outline" text={String(s.view_count ?? 0)} onPress={() => setSheet('viewers')} label="Who viewed it" />
                        <Chip icon="thumbs-up-outline" text={String(reactions.like)} label="Likes" />
                        <Chip icon="heart-outline" text={String(reactions.love)} label="Loves" />
                        <View style={{ flex: 1 }} />
                        <Chip icon="chatbubble-outline" text={String(s.comment_count ?? 0)} onPress={() => setSheet('comments')} label="Comments" />
                    </>
                ) : !interact ? (
                    <Text style={{ color: 'rgba(255,255,255,0.7)', flex: 1, textAlign: 'center' }}>Likes, comments and replies are switched off.</Text>
                ) : (
                    <>
                        <Chip icon={s.my_reaction === 'like' ? 'thumbs-up' : 'thumbs-up-outline'} text={reactions.like ? String(reactions.like) : ''} active={s.my_reaction === 'like'} onPress={() => react('like')} label="Like" />
                        <Chip icon={s.my_reaction === 'love' ? 'heart' : 'heart-outline'} text={reactions.love ? String(reactions.love) : ''} active={s.my_reaction === 'love'} love onPress={() => react('love')} label="Love" />
                        <Chip icon="chatbubble-outline" text={String(s.comment_count ?? 0)} onPress={() => setSheet('comments')} label="Comments" />
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingLeft: 12, paddingRight: 4 }}>
                            <TextInput value={reply} onChangeText={setReply} placeholder="Reply privately…" placeholderTextColor="rgba(255,255,255,0.65)" maxLength={4000}
                                style={{ flex: 1, color: '#fff', paddingVertical: 9, fontSize: 15 }} onSubmitEditing={sendReply} returnKeyType="send" />
                            {reply.trim() ? <Pressable onPress={sendReply} accessibilityLabel="Send reply" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.leaf, alignItems: 'center', justifyContent: 'center' }}><Icon name="send" size={16} color="#fff" /></Pressable> : null}
                        </View>
                    </>
                )}
            </View>

            {sheet === 'comments' && <CommentsSheet status={s} meId={me?.id ?? 0} onCount={(n) => update(s.id, { comment_count: n })} onClose={() => setSheet(null)} />}
            {sheet === 'viewers' && <ViewersSheet statusId={s.id} onClose={() => setSheet(null)} />}
        </KeyboardAvoidingView>
    );
}

function pick(all: Status[], uid: number, meId: number): Status[] {
    const g = group(all, meId);
    return (uid === meId ? g.mine : g.others.find((x) => x.userId === uid))?.items ?? [];
}

function Chip({ icon, text, onPress, active, love, label }: { icon: any; text: string; onPress?: () => void; active?: boolean; love?: boolean; label: string }) {
    return (
        <Pressable onPress={onPress} disabled={!onPress} accessibilityLabel={label} accessibilityState={{ selected: !!active }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? (love ? '#ff4d6d' : colors.leaf) : 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 }}>
            <Icon name={icon} size={18} color="#fff" />
            {text ? <Text style={{ color: '#fff', fontWeight: '600' }}>{text}</Text> : null}
        </Pressable>
    );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <Modal visible transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ maxHeight: '75%', backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
                    <Text style={[ui.h2, { flex: 1 }]}>{title}</Text>
                    <IconButton name="close" label="Close" color={colors.muted} onPress={onClose} />
                </View>
                {children}
            </KeyboardAvoidingView>
        </Modal>
    );
}

function CommentsSheet({ status, meId, onCount, onClose }: { status: Status; meId: number; onCount: (n: number) => void; onClose: () => void }) {
    const [list, setList] = useState<Comment[] | null>(null);
    const [text, setText] = useState('');
    const [replyTo, setReplyTo] = useState<Comment | null>(null);
    const input = useRef<TextInput>(null);
    useEffect(() => { api<{ comments: Comment[] }>(`/status/${status.id}/comments`).then((r) => setList(r.comments)).catch((e) => { Alert.alert('Comments', e.message); setList([]); }); }, [status.id]);

    const post = async () => {
        if (!text.trim()) return;
        try {
            const r = await api<{ comment: Comment }>(`/status/${status.id}/comments`, { body: { body: text.trim(), reply_to_id: replyTo?.id ?? null } });
            const next = [...(list ?? []), r.comment];
            setList(next); onCount(next.length); setText(''); setReplyTo(null);
        } catch (e) { Alert.alert('Not posted', (e as Error).message); }
    };
    const remove = (c: Comment) => Alert.alert('Delete this comment?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
            await api(`/status/${status.id}/comments/${c.id}`, { method: 'DELETE' }).catch((e) => Alert.alert('Not deleted', e.message));
            const next = (list ?? []).filter((x) => x.id !== c.id);
            setList(next); onCount(next.length);
        } },
    ]);

    return (
        <Sheet title={`Comments${list ? ` (${list.length})` : ''}`} onClose={onClose}>
            {list === null ? <ActivityIndicator color={colors.leaf} style={{ margin: 24 }} /> : (
                <FlatList data={list} keyExtractor={(c) => String(c.id)} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 14 }}
                    ListEmptyComponent={<Text style={[ui.small, { textAlign: 'center', padding: 20 }]}>No comments yet. Be the first.</Text>}
                    renderItem={({ item: c }) => (
                        <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
                            <Avatar name={c.user.name} size={32} />
                            <View style={{ flex: 1 }}>
                                <View style={{ backgroundColor: colors.mist, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                                    <Text style={{ fontWeight: '700', color: colors.ink }}>{c.user.id === meId ? 'You' : c.user.name}</Text>
                                    {c.reply_to ? <Text style={[ui.small, { borderLeftWidth: 2, borderLeftColor: colors.leaf, paddingLeft: 6, marginVertical: 2 }]} numberOfLines={1}>{c.reply_to.name}: {c.reply_to.body}</Text> : null}
                                    <Text style={ui.text}>{c.body}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 8, paddingTop: 3 }}>
                                    <Text style={ui.small}>{chatTime(c.created_at)}</Text>
                                    <Pressable onPress={() => { setReplyTo(c); input.current?.focus(); }} hitSlop={8}><Text style={[ui.small, { fontWeight: '700' }]}>Reply</Text></Pressable>
                                    {c.can_delete && <Pressable onPress={() => remove(c)} hitSlop={8}><Text style={[ui.small, { fontWeight: '700', color: colors.sos }]}>Delete</Text></Pressable>}
                                </View>
                            </View>
                        </View>
                    )} />
            )}
            {replyTo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6 }}>
                    <Text style={[ui.small, { flex: 1 }]} numberOfLines={1}>Replying to <Text style={{ fontWeight: '700', color: colors.ink }}>{replyTo.user.name}</Text></Text>
                    <IconButton name="close" label="Cancel reply" color={colors.muted} size={18} onPress={() => setReplyTo(null)} />
                </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderColor: colors.line }}>
                <TextInput ref={input} value={text} onChangeText={setText} maxLength={500} placeholder={replyTo ? `Reply to ${replyTo.user.name}` : 'Add a comment'} placeholderTextColor={colors.muted}
                    style={{ flex: 1, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.ink }} />
                <Pressable onPress={post} disabled={!text.trim()} accessibilityLabel="Post comment"
                    style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.leaf, opacity: text.trim() ? 1 : 0.4, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="send" size={18} color="#fff" />
                </Pressable>
            </View>
        </Sheet>
    );
}

function ViewersSheet({ statusId, onClose }: { statusId: number; onClose: () => void }) {
    const [list, setList] = useState<{ id: number; name: string; viewed_at: string; reaction: 'like' | 'love' | null }[] | null>(null);
    useEffect(() => { api<{ viewers: any[] }>(`/status/${statusId}/viewers`).then((r) => setList(r.viewers)).catch(() => setList([])); }, [statusId]);
    return (
        <Sheet title={`Viewed by${list ? ` ${list.length}` : ''}`} onClose={onClose}>
            {list === null ? <ActivityIndicator color={colors.leaf} style={{ margin: 24 }} /> : (
                <FlatList data={list} keyExtractor={(v) => String(v.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
                    ListEmptyComponent={<Text style={[ui.small, { textAlign: 'center', padding: 20 }]}>Nobody has viewed it yet.</Text>}
                    renderItem={({ item: v }) => (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                            <Avatar name={v.name} size={38} />
                            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: colors.ink }}>{v.name}</Text><Text style={ui.small}>{chatTime(v.viewed_at)}</Text></View>
                            {v.reaction === 'love' && <Icon name="heart" color="#ff4d6d" />}
                            {v.reaction === 'like' && <Icon name="thumbs-up" color={colors.leaf} />}
                        </View>
                    )} />
            )}
        </Sheet>
    );
}

function StatusVideo({ uri, headers, paused, onTime, onEnd }: { uri: string; headers: Record<string, string>; paused: boolean; onTime: (t: number, d: number) => void; onEnd: () => void }) {
    const player = useVideoPlayer({ uri, headers }, (p) => { p.timeUpdateEventInterval = 0.25; p.play(); });
    const time = useEvent(player, 'timeUpdate');
    useEffect(() => { if (time) onTime(time.currentTime, player.duration); }, [time]);
    useEffect(() => { const sub = player.addListener('playToEnd', onEnd); return () => sub.remove(); }, [player, onEnd]);
    useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
    return <VideoView player={player} style={{ width: '100%', height: '70%' }} contentFit="contain" nativeControls={false} />;
}

function StatusAudio({ path, paused, onTime, onEnd }: { path: string; paused: boolean; onTime: (t: number, d: number) => void; onEnd: () => void }) {
    const [uri, setUri] = useState<string | null>(null);
    useEffect(() => { cachedFile(path).then(setUri).catch(() => {}); }, [path]);
    const player = useAudioPlayer(uri ? { uri } : null);
    const st = useAudioPlayerStatus(player);
    useEffect(() => { if (uri) player.play(); }, [uri, player]);
    useEffect(() => { if (!uri) return; if (paused) player.pause(); else player.play(); }, [paused, uri, player]);
    useEffect(() => { onTime(st.currentTime, st.duration); if (st.didJustFinish) onEnd(); }, [st.currentTime, st.didJustFinish]);
    return (
        <View style={{ alignItems: 'center', gap: 14, padding: 30 }}>
            {uri ? <Icon name="musical-notes" size={72} color="#fff" /> : <ActivityIndicator color="#fff" />}
        </View>
    );
}
