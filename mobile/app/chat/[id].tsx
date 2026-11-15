import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { useCalls } from '@/calls/CallContext';
import type { ChatRow } from '@/chat/ChatListItem';
import { chatIcon } from '@/chat/ChatListItem';
import { chatOptions } from '@/chat/controls';
import { MessageBubble, quoteText, type Msg } from '@/chat/MessageBubble';
import { StickerPanel } from '@/chat/StickerPanel';
import { stickerById } from '@/chat/stickers';
import { insertMention, mentionQuery, type Mention } from '@/chat/mentions';
import { saveServerMessage, type ServerMessage } from '@/chat/store';
import type { Quote } from '@/chat/send';
import { sendMedia, sendText } from '@/chat/send';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { on } from '@/lib/events';
import { pickDocument, pickPhoto } from '@/lib/files';
import { chatTime, dayLabel, duration } from '@/lib/format';
import { SyncEngine } from '@/sync/SyncEngine';
import { subscribeConversation } from '@/sync/realtime';
import { Avatar, BackBar, Icon, IconButton, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Item = { kind: 'msg'; m: Msg } | { kind: 'day'; label: string; key: string };

const REPORT_REASONS = ['Harassment or bullying', 'Threat or violence', 'Spam or scam', 'Something else that breaks the rules'];

/** Simple choice sheet: native action sheet on iPhone, a dialog on Android. */
function choose(title: string, options: string[], onPick: (i: number) => void, destructive?: number) {
    if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options, 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: destructive }, (i) => i < options.length && onPick(i));
    } else {
        Alert.alert(title, undefined, [...options.map((o, i) => ({ text: o, style: i === destructive ? 'destructive' as const : 'default' as const, onPress: () => onPick(i) })), { text: 'Cancel', style: 'cancel' as const }], { cancelable: true });
    }
}

export default function ChatScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const conversationId = Number(id);
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { me, can, has } = useAuth();
    const calls = useCalls();
    const [conv, setConv] = useState<ChatRow | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [text, setText] = useState('');
    const [online, setOnline] = useState(SyncEngine.online);
    const [canDelete, setCanDelete] = useState(false);
    const [limit, setLimit] = useState(300);
    const [replyTo, setReplyTo] = useState<Msg | null>(null);
    const [editing, setEditing] = useState<Msg | null>(null);
    const [mentioned, setMentioned] = useState<Mention[]>([]);
    const [suggest, setSuggest] = useState<{ start: number; people: Mention[] } | null>(null);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState('');
    const [results, setResults] = useState<Msg[] | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [noMore, setNoMore] = useState(false);
    const list = useRef<FlatList<Item>>(null);
    const pendingJump = useRef<string | null>(null);
    const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [panel, setPanel] = useState(false);
    const [liveCall, setLiveCall] = useState<{ call_uuid: string; type: 'voice' | 'video'; participants: { id: number; name: string }[]; in_call: boolean } | null>(null);
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const rec = useAudioRecorderState(recorder, 250);

    const load = useCallback(async () => {
        const d = await db();
        const c = await d.getFirstAsync<ChatRow>('SELECT * FROM conversations WHERE id = ?', conversationId);
        setConv(c);
        // Paused: newer messages from others are held back until I resume (mine always show).
        const held = c?.paused_after ?? null;
        setMessages(held === null
            ? await d.getAllAsync<Msg>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT ?', conversationId, limit)
            : await d.getAllAsync<Msg>('SELECT * FROM messages WHERE conversation_id = ? AND (id IS NULL OR id <= ? OR sender_id = ?) ORDER BY sent_at DESC LIMIT ?', conversationId, held, me?.id ?? 0, limit));
    }, [conversationId, limit, me?.id]);

    useEffect(() => {
        load();
        const off = on('messages', (e) => e.conversationId === conversationId && load());
        const off2 = on('online', setOnline);
        const unsub = subscribeConversation(conversationId, () => SyncEngine.run());
        (async () => {
            const d = await db();
            await d.runAsync('UPDATE conversations SET unread = 0 WHERE id = ?', conversationId);
            if (!SyncEngine.online) return;
            // Newest page from the server (first open, or after a long time away), and what I may do here.
            const r = await api<{ messages: any[] }>(`/conversations/${conversationId}/messages`).catch(() => null);
            for (const m of r?.messages ?? []) await saveServerMessage(d, m);
            const last = r?.messages?.[r.messages.length - 1];
            if (last) api(`/conversations/${conversationId}/read`, { body: { last_read_message_id: last.id } }).catch(() => {});
            api<{ conversation: { can: { delete_messages: boolean } } }>(`/conversations/${conversationId}`).then((x) => setCanDelete(x.conversation.can.delete_messages)).catch(() => {});
            load();
            d.runAsync('UPDATE conversations SET unread = 0 WHERE id = ?', conversationId).then(() => SyncEngine.refreshConversations().catch(() => {}));
        })();
        return () => { off(); off2(); unsub(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);
    useEffect(() => { load(); }, [load]);

    // Group chats: is a call running here? (shows the "Join" bar)
    const checkCall = useCallback(() => {
        if (!SyncEngine.online) { setLiveCall(null); return; }
        api<{ call: typeof liveCall }>(`/conversations/${conversationId}/call`).then((r) => setLiveCall(r.call)).catch(() => setLiveCall(null));
    }, [conversationId]);
    useEffect(() => {
        if (!conv || conv.type === 'direct') return;
        checkCall();
        const off = on('messages', (e) => e.conversationId === conversationId && checkCall());
        const t = setInterval(checkCall, 20_000);
        return () => { off(); clearInterval(t); };
    }, [conv?.type, checkCall, calls.group?.uuid]);

    // After the list grows to include a message we jumped to, scroll to it.
    useEffect(() => {
        const target = pendingJump.current;
        if (!target) return;
        const index = items.findIndex((it) => it.kind === 'msg' && it.m.client_id === target);
        if (index >= 0) {
            pendingJump.current = null;
            setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 80);
            setFlash(target);
            setTimeout(() => setFlash(null), 2200);
        }
    });

    /** Older history from the server when scrolled to the top. */
    const loadOlder = async () => {
        if (loadingOlder || noMore || !SyncEngine.online) { setLimit((l) => l + 200); return; }
        const oldest = [...messages].reverse().find((m) => m.id);
        if (!oldest) return;
        setLoadingOlder(true);
        try {
            const r = await api<{ messages: ServerMessage[]; has_more: boolean }>(`/conversations/${conversationId}/messages?before=${oldest.id}`);
            const d = await db();
            for (const m of r.messages) await saveServerMessage(d, m);
            if (!r.has_more) setNoMore(true);
            setLimit((l) => l + r.messages.length + 50);
        } catch { /* try again on the next scroll */ } finally { setLoadingOlder(false); }
    };

    /** Scrolls to a message by its server id, fetching the part of the history around it if it isn't on the phone. */
    const jumpTo = async (serverId: number) => {
        const d = await db();
        let row = await d.getFirstAsync<{ client_id: string; sent_at: string }>('SELECT client_id, sent_at FROM messages WHERE id = ? AND conversation_id = ?', serverId, conversationId);
        if (!row && SyncEngine.online) {
            const r = await api<{ messages: ServerMessage[] }>(`/conversations/${conversationId}/messages?around=${serverId}`).catch(() => null);
            for (const m of r?.messages ?? []) await saveServerMessage(d, m);
            row = await d.getFirstAsync<{ client_id: string; sent_at: string }>('SELECT client_id, sent_at FROM messages WHERE id = ? AND conversation_id = ?', serverId, conversationId);
        }
        if (!row) { Alert.alert('Not available', SyncEngine.online ? 'That message is no longer here.' : 'Connect to the internet to load older messages.'); return; }
        const newer = await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND sent_at >= ?', conversationId, row.sent_at);
        pendingJump.current = row.client_id;
        setSearching(false);
        setLimit((l) => Math.max(l, (newer?.n ?? 0) + 40));
        load();
    };

    /** Searches what's on the phone straight away, then the full history on the server when online. */
    const runSearch = async (text: string) => {
        setQ(text);
        if (text.trim().length < 2) { setResults(null); return; }
        const d = await db();
        const local = await d.getAllAsync<Msg>("SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 AND body LIKE ? ORDER BY sent_at DESC LIMIT 50", conversationId, `%${text.trim()}%`);
        setResults(local);
        if (!SyncEngine.online) return;
        const r = await api<{ results: ServerMessage[] }>(`/conversations/${conversationId}/search?q=${encodeURIComponent(text.trim())}`).catch(() => null);
        if (!r) return;
        for (const m of r.results) await saveServerMessage(d, m);
        const ids = r.results.map((m) => m.client_id);
        const merged = ids.length ? await d.getAllAsync<Msg>(`SELECT * FROM messages WHERE client_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
        const all = new Map<string, Msg>([...local, ...merged].map((m) => [m.client_id, m]));
        setResults([...all.values()].sort((a, b) => b.sent_at.localeCompare(a.sent_at)));
    };

    // "@na" typed before the cursor: suggest members of this group (needs internet).
    const onType = (value: string) => {
        setText(value);
        const caret = Math.min(selection.end + (value.length - text.length), value.length);
        const found = conv?.type !== 'direct' ? mentionQuery(value.slice(0, Math.max(caret, 0))) : null;
        if (!found || !SyncEngine.online || mentioned.some((p) => found.query.startsWith(p.name))) { setSuggest(null); return; }
        if (suggestTimer.current) clearTimeout(suggestTimer.current);
        suggestTimer.current = setTimeout(() => {
            api<{ members: Mention[] }>(`/conversations/${conversationId}/members?q=${encodeURIComponent(found.query)}`)
                .then((r) => setSuggest({ start: found.start, people: r.members.filter((p) => p.id !== me?.id).slice(0, 5) }))
                .catch(() => setSuggest(null));
        }, 200);
    };
    const pickMention = (p: Mention) => {
        if (!suggest) return;
        const r = insertMention(text, suggest.start, selection.end, p.name);
        setText(r.text);
        setSelection({ start: r.caret, end: r.caret });
        setMentioned((l) => (l.some((x) => x.id === p.id) ? l : [...l, { id: p.id, name: p.name }]));
        setSuggest(null);
    };

    const asQuote = (m: Msg): Quote => ({ id: m.id ?? 0, client_id: m.client_id, sender_id: m.sender_id, sender_name: m.sender_name, type: m.type, body: m.body });

    const saveEdit = async () => {
        if (!editing?.id) return;
        const body = text.trim();
        try {
            const r = await api<{ message: ServerMessage }>(`/messages/${editing.id}`, { method: 'PATCH', body: { body } });
            await saveServerMessage(await db(), r.message);
            setEditing(null);
            setText('');
            load();
        } catch (e) { Alert.alert('Not saved', (e as Error).message); }
    };

    // Newest first (the list is inverted), with a day label after the last message of each day.
    const items = useMemo<Item[]>(() => {
        const out: Item[] = [];
        messages.forEach((m, i) => {
            out.push({ kind: 'msg', m });
            const next = messages[i + 1];
            if (!next || new Date(next.sent_at).toDateString() !== new Date(m.sent_at).toDateString()) out.push({ kind: 'day', label: dayLabel(m.sent_at), key: `d-${m.sent_at.slice(0, 10)}-${i}` });
        });
        return out;
    }, [messages]);

    const peer = conv?.peer_json ? JSON.parse(conv.peer_json) : null;
    const isDirect = conv?.type === 'direct';
    const canPost = conv ? conv.can_post !== 0 : true;
    const files = has('file_sharing');
    const voiceCall = isDirect && has('voice_calls') && can('calls.voice');
    const videoCall = isDirect && has('video_calls') && can('calls.video');
    const groupVoice = !isDirect && canPost && has('group_calls') && has('voice_calls') && can('calls.voice') && !liveCall;
    const groupVideo = !isDirect && canPost && has('group_calls') && has('video_calls') && can('calls.video') && !liveCall;
    const voiceNotes = has('voice_notes');
    const callError = (e: unknown) => Alert.alert('Call', (e as Error).message);

    const send = async () => {
        const body = text.trim();
        if (!body) return;
        if (editing) return saveEdit();
        const quote = replyTo?.id ? asQuote(replyTo) : null;
        setText('');
        setReplyTo(null);
        setMentioned([]);
        setSuggest(null);
        try { await sendText(conversationId, body, { replyTo: quote, mentions: mentioned }); } catch (e) { Alert.alert('Not sent', (e as Error).message); }
    };
    const sendSticker = async (id: string) => {
        setPanel(false);
        const quote = replyTo?.id ? asQuote(replyTo) : null;
        setReplyTo(null);
        try { await sendText(conversationId, stickerById(id)?.label ?? 'Sticker', { replyTo: quote, sticker: id }); } catch (e) { Alert.alert('Not sent', (e as Error).message); }
    };
    const insertEmoji = (e: string) => {
        const at = Math.min(selection.end, text.length);
        setText(text.slice(0, at) + e + text.slice(at));
        setSelection({ start: at + e.length, end: at + e.length });
    };
    const quoteForMedia = () => { const qt = replyTo?.id ? asQuote(replyTo) : null; setReplyTo(null); return qt; };

    const attach = () => {
        if (!has('file_sharing')) return;
        choose(online ? 'Send' : 'Send (goes when you have internet)', ['Photo from gallery', 'Take a photo', 'Document'], async (i) => {
            const file = i === 2 ? await pickDocument() : await pickPhoto(i === 1);
            if (!file) return;
            if (file.size && file.size > 15 * 1024 * 1024) { Alert.alert('Too large', 'Files can be up to 15 MB.'); return; }
            sendMedia(conversationId, file, i === 2 ? 'file' : 'image', { replyTo: quoteForMedia() }).catch((e) => Alert.alert('Not sent', (e as Error).message));
        });
    };

    const startRecording = async () => {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) { Alert.alert('Microphone', 'Allow the microphone in your phone settings to record voice notes.'); return; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
    };
    const stopRecording = async (keep: boolean) => {
        const secs = rec.durationMillis / 1000;
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!keep || !recorder.uri || secs < 1) return;
        sendMedia(conversationId, { uri: recorder.uri, name: `voice-${Date.now()}.m4a`, mime: 'audio/mp4' }, 'voice', { duration: secs, replyTo: quoteForMedia() })
            .catch((e) => Alert.alert('Not sent', (e as Error).message));
    };

    const onLongPress = (m: Msg) => {
        if (m.deleted) return;
        const mine = m.sender_id === me?.id;
        const opts: { label: string; run: () => void }[] = [];
        if (m.id && canPost) opts.push({ label: 'Reply', run: () => { setReplyTo(m); setEditing(null); } });
        if (m.type === 'text' && m.body) opts.push({ label: 'Copy', run: () => Clipboard.setStringAsync(m.body ?? '') });
        if (m.id && mine && m.type === 'text' && Date.now() - new Date(m.sent_at).getTime() < 15 * 60_000 && online)
            opts.push({ label: 'Edit', run: () => { setEditing(m); setReplyTo(null); setText(m.body ?? ''); } });
        if (m.id && (mine || canDelete)) opts.push({ label: 'Delete for everyone', run: () => api(`/messages/${m.id}`, { method: 'DELETE' }).then(() => SyncEngine.run()).catch((e) => Alert.alert('Not deleted', e.message)) });
        if (m.id && !mine) opts.push({ label: 'Report', run: () => choose('Why are you reporting this?', REPORT_REASONS, (i) =>
            api(`/messages/${m.id}/report`, { body: { reason: REPORT_REASONS[i] } }).then(() => Alert.alert('Reported', 'Thank you. Moderators at your institution will look at it.')).catch((e) => Alert.alert('Not sent', e.message))) });
        if (opts.length) choose('Message', opts.map((o) => o.label), (i) => opts[i].run(), opts.findIndex((o) => o.label.startsWith('Delete')));
    };

    const subtitle = isDirect ? (peer?.title ?? 'Tap for info') : conv ? `${conv.member_count} members · tap for info` : null;

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.chatBg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <BackBar title={conv?.name ?? ''} subtitle={subtitle} onTitlePress={() => router.push(`/group/${conversationId}`)}
                avatar={conv ? <Avatar name={conv.name} size={38} icon={chatIcon(conv)} /> : null}
                right={<>
                    <IconButton name="search" label="Search this chat" onPress={() => { setSearching(!searching); setResults(null); setQ(''); }} />
                    {conv && (has('mute_chats') || has('archive_chats') || has('pause_chats')) && <IconButton name="ellipsis-vertical" label="Mute, archive or pause" onPress={() => chatOptions(conv, has, load)} />}
                    {videoCall && <IconButton name="videocam-outline" label="Video call" onPress={() => calls.start({ id: peer.id, name: peer.name }, 'video').catch((e) => Alert.alert('Call', e.message))} />}
                    {voiceCall && <IconButton name="call-outline" label="Voice call" onPress={() => calls.start({ id: peer.id, name: peer.name }, 'voice').catch((e) => Alert.alert('Call', e.message))} />}
                    {groupVideo && <IconButton name="videocam-outline" label="Group video call" onPress={() => calls.startGroup(conversationId, 'video').catch(callError)} />}
                    {groupVoice && <IconButton name="call-outline" label="Group voice call" onPress={() => calls.startGroup(conversationId, 'voice').catch(callError)} />}
                </>} />
            {liveCall && !liveCall.in_call && !calls.group && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.mint, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.leaf, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={liveCall.type === 'video' ? 'videocam' : 'call'} color="#fff" size={18} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700', color: colors.grove }}>{liveCall.type === 'video' ? 'Video' : 'Voice'} call in progress</Text>
                        <Text style={ui.small} numberOfLines={1}>{liveCall.participants.map((p) => (p.id === me?.id ? 'You' : p.name)).join(', ')}</Text>
                    </View>
                    <Pressable onPress={() => calls.joinGroup(liveCall.call_uuid).catch(callError)} style={{ backgroundColor: colors.leaf, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 }}>
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Join</Text>
                    </Pressable>
                </View>
            )}
            {conv?.paused_after != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberBg, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Icon name="pause-circle-outline" size={20} color={colors.ink} />
                    <Text style={[ui.small, { flex: 1, color: colors.ink }]}>You paused this chat. New messages are held back, with no alerts, until you resume.</Text>
                    <Pressable onPress={async () => { await api(`/conversations/${conversationId}`, { method: 'PATCH', body: { paused: false } }).catch(() => {}); await SyncEngine.refreshConversations(); load(); }}
                        style={{ backgroundColor: colors.leaf, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}><Text style={{ color: '#fff', fontWeight: '700' }}>Resume</Text></Pressable>
                </View>
            )}
            {!online && <Text style={{ backgroundColor: colors.amberBg, color: colors.ink, fontSize: 12.5, paddingHorizontal: 14, paddingVertical: 6 }}>Offline: text goes to people nearby and sends when you reconnect.</Text>}
            {searching && (
                <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderColor: colors.line, maxHeight: '60%' }}>
                    <View style={[ui.row, { margin: 10, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 14 }]}>
                        <Icon name="search" size={18} color={colors.muted} />
                        <TextInput autoFocus style={{ flex: 1, paddingVertical: 9, fontSize: 15, color: colors.ink }} placeholder="Search messages" placeholderTextColor={colors.muted} value={q} onChangeText={runSearch} />
                        <IconButton name="close" label="Close search" color={colors.muted} size={20} onPress={() => { setSearching(false); setResults(null); }} />
                    </View>
                    {results && (
                        <FlatList data={results} keyExtractor={(m) => m.client_id} keyboardShouldPersistTaps="handled"
                            ListEmptyComponent={<Text style={[ui.small, { padding: 14 }]}>No messages match{online ? '' : ' on this phone'}.</Text>}
                            renderItem={({ item }) => (
                                <ListRow title={item.sender_id === me?.id ? 'You' : item.sender_name} subtitle={item.body} right={<Text style={ui.small}>{chatTime(item.sent_at)}</Text>}
                                    onPress={() => (item.id ? jumpTo(item.id) : undefined)} />
                            )} />
                    )}
                </View>
            )}
            <FlatList
                ref={list}
                inverted
                data={items}
                onEndReached={loadOlder}
                onEndReachedThreshold={0.4}
                ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.leaf} style={{ margin: 12 }} /> : null}
                onScrollToIndexFailed={(info) => setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 300)}
                keyExtractor={(it) => (it.kind === 'msg' ? it.m.client_id : it.key)}
                contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
                renderItem={({ item, index }) => {
                    if (item.kind === 'day') {
                        return <Text style={{ alignSelf: 'center', backgroundColor: '#fff', color: colors.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, marginVertical: 8, overflow: 'hidden' }}>{item.label}</Text>;
                    }
                    const older = items[index + 1];
                    const showName = !isDirect && (!older || older.kind !== 'msg' || older.m.sender_id !== item.m.sender_id);
                    return <MessageBubble m={item.m} mine={item.m.sender_id === me?.id} showName={showName} meId={me?.id} flash={flash === item.m.client_id}
                        onLongPress={() => onLongPress(item.m)} onQuotePress={jumpTo} />;
                }}
            />
            {canPost && (replyTo || editing) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', marginHorizontal: 8, marginTop: 6, borderRadius: 14, padding: 10 }}>
                    <Icon name={editing ? 'create-outline' : 'arrow-undo'} color={colors.leaf} size={20} />
                    <View style={{ flex: 1, borderLeftWidth: 4, borderLeftColor: colors.leaf, paddingLeft: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.leaf }}>{editing ? 'Edit message' : `Replying to ${replyTo!.sender_id === me?.id ? 'yourself' : replyTo!.sender_name}`}</Text>
                        <Text style={ui.small} numberOfLines={1}>{quoteText((editing ?? replyTo)!)}</Text>
                    </View>
                    <IconButton name="close" label="Cancel" color={colors.muted} size={20} onPress={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }} />
                </View>
            )}
            {canPost && suggest && suggest.people.length > 0 && (
                <View style={{ backgroundColor: '#fff', marginHorizontal: 8, marginTop: 6, borderRadius: 14, overflow: 'hidden' }}>
                    {suggest.people.map((p) => <ListRow key={p.id} title={p.name} left={<Avatar name={p.name} size={32} />} onPress={() => pickMention(p)} />)}
                </View>
            )}
            {canPost ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 8, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) }}>
                    {rec.isRecording ? (
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 14, minHeight: 48 }}>
                            <Icon name="mic" color={colors.sos} />
                            <Text style={[ui.text, { flex: 1 }]}>Recording {duration(rec.durationMillis / 1000)}</Text>
                            <Pressable onPress={() => stopRecording(false)} hitSlop={8}><Text style={{ color: colors.sos, fontWeight: '600' }}>Cancel</Text></Pressable>
                        </View>
                    ) : (
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 6, minHeight: 48 }}>
                            <IconButton name="happy-outline" label="Emojis and stickers" color={colors.muted} onPress={() => setPanel(true)} />
                            {has('file_sharing') && <IconButton name="attach" label="Attach" color={files ? colors.muted : colors.line} onPress={attach} />}
                            <TextInput style={{ flex: 1, fontSize: 16, color: colors.ink, paddingHorizontal: 6, paddingTop: 13, paddingBottom: 13, maxHeight: 120 }}
                                placeholder={conv?.type === 'direct' ? 'Message' : 'Message (@ to mention)'} placeholderTextColor={colors.muted} value={text} onChangeText={onType}
                                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)} multiline maxLength={4000} />
                            {has('file_sharing') && !text && <IconButton name="camera-outline" label="Camera" color={files ? colors.muted : colors.line}
                                onPress={async () => { const f = await pickPhoto(true); if (f) sendMedia(conversationId, f, 'image', { replyTo: quoteForMedia() }).catch((e) => Alert.alert('Not sent', e.message)); }} />}
                        </View>
                    )}
                    <Pressable
                        onPress={rec.isRecording ? () => stopRecording(true) : text.trim() || editing ? send : voiceNotes ? startRecording : send}
                        accessibilityLabel={rec.isRecording ? 'Send voice note' : text.trim() ? 'Send' : 'Record voice note'}
                        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: pressed ? colors.leafDark : colors.leaf, alignItems: 'center', justifyContent: 'center' })}>
                        <Icon name={editing ? 'checkmark' : rec.isRecording || text.trim() || !voiceNotes ? 'send' : 'mic'} color="#fff" size={21} />
                    </Pressable>
                </View>
            ) : (
                <View style={{ padding: 14, paddingBottom: Math.max(insets.bottom, 14), backgroundColor: '#fff', alignItems: 'center' }}>
                    <Text style={ui.small}>{conv?.auto_type === 'announcements' ? 'Only people allowed to post notices can write here.' : 'Only group admins can send messages here.'}</Text>
                </View>
            )}
            <StickerPanel visible={panel} onClose={() => setPanel(false)} onEmoji={insertEmoji} onSticker={sendSticker} stickers={has('stickers')} />
        </KeyboardAvoidingView>
    );
}
