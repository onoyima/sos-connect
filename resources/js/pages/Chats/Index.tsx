import { Head, usePage } from '@inertiajs/react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, AtSign, BellOff, Check, EllipsisVertical, PauseCircle, PlayCircle, Plus, CheckCheck, ChevronDown, ChevronRight, Clock, FileText, Flag, Lock, Megaphone, MessageCircle, Paperclip, Pencil, Phone, Radio, Reply, Search, SendHorizontal, Smile, SquarePen, Trash2, UserPlus, Users, UsersRound, Video, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { joinGroupCall, startCall, startGroupCall } from '@/components/CallManager';
import { MicButton, VoicePlayer, VoiceRecorder, canRecordVoice } from '@/components/VoiceNote';
import { EmojiPanel, StickerView } from '@/components/EmojiPanel';
import { GroupInfo } from '@/components/GroupInfo';
import { stickerById } from '@/lib/stickers';
import { Avatar, EmptyState, Modal, memberLabel, when } from '@/components/ui';
import { api, fileUrl, uuid } from '@/lib/api';
import { listenUser, onChange, onMessage, refreshBadges } from '@/lib/live';
import type { ChatMessage, Community, ConversationSummary, SharedProps } from '@/types';

type Person = { id: number; name: string; title?: string | null; member_type?: string; department?: string; level?: number };

export default function Chats({ openConversationId }: { openConversationId: number | null }) {
    const { auth, reverb, modules } = usePage<SharedProps>().props;
    const me = auth!.user;
    const [recording, setRecording] = useState(false);
    const [panel, setPanel] = useState<null | 'emoji' | 'sticker'>(null);
    const [infoOpen, setInfoOpen] = useState(false);
    const [sendingVoice, setSendingVoice] = useState(false);
    const [liveCall, setLiveCall] = useState<{ call_uuid: string; type: 'voice' | 'video'; participants: { id: number; name: string }[]; in_call: boolean } | null>(null);
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [communities, setCommunities] = useState<Community[]>([]);
    const [view, setView] = useState<'chats' | 'communities'>('chats');
    const [communityId, setCommunityId] = useState<number | null>(null);
    const [activeId, setActiveId] = useState<number | null>(openConversationId);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [picker, setPicker] = useState<null | 'direct' | 'group'>(null);
    const [filter, setFilter] = useState('');
    const bottom = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const [editing, setEditing] = useState<ChatMessage | null>(null);
    const [mentioned, setMentioned] = useState<{ id: number; name: string }[]>([]);
    const [suggest, setSuggest] = useState<{ query: string; people: Person[] } | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchQ, setSearchQ] = useState('');
    const [results, setResults] = useState<ChatMessage[] | null>(null);
    const [flash, setFlash] = useState<number | null>(null);
    const [hasNewer, setHasNewer] = useState(false);
    const [canDelete, setCanDelete] = useState(false);
    const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

    const loadConversations = useCallback(async () => {
        const r = await api<{ conversations: ConversationSummary[]; communities: Community[] }>('/conversations');
        setConversations(r.conversations);
        setCommunities(r.communities ?? []);
    }, []);

    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const ready = () => { setLoaded(true); (window as { __sosReady?: () => void }).__sosReady?.(); };
        if (auth!.permissions.includes('chat.use')) loadConversations().then(ready, ready); else ready();
    }, [loadConversations]);

    // Realtime: every chat I'm in is watched by the shared live module (one channel per chat), so messages arrive at once.
    useEffect(() => onMessage((kind, m) => {
        if (!conversationsRef.current.some((c) => c.id === m.conversation_id)) { loadConversations().catch(() => {}); return; } // a new chat
        onIncoming(m);
        if (kind === 'message.created' && m.conversation_id === activeIdRef.current && m.sender_id !== me.id && m.id > 0) {
            api(`/conversations/${m.conversation_id}/read`, { body: { last_read_message_id: m.id } }).then(() => refreshBadges()).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    const onIncoming = (m: ChatMessage) => {
        // A paused chat holds back new messages (they appear when I resume it).
        const held = conversationsRef.current.find((c) => c.id === m.conversation_id)?.paused_after;
        if (held !== null && held !== undefined && m.id > held && m.sender_id !== me.id) return;
        if (m.type === 'system' && m.meta?.call && m.conversation_id === activeIdRef.current) checkCall(m.conversation_id);
        setMessages((prev) => {
            if (m.conversation_id !== activeIdRef.current) return prev;
            const i = prev.findIndex((x) => x.id === m.id || x.client_id === m.client_id);
            if (i === -1) return [...prev, m];
            const copy = prev.slice();
            copy[i] = m;
            return copy;
        });
        setConversations((prev) => prev.map((c) => c.id === m.conversation_id
            ? { ...c, last_message: m, last_message_at: m.created_at, unread: c.id === activeIdRef.current || m.sender_id === me.id ? 0 : c.unread + 1 }
            : c).sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')));
    };
    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;

    const checkCall = (id: number) => {
        const c = conversationsRef.current.find((x) => x.id === id);
        if (!c || c.type === 'direct') { setLiveCall(null); return; }
        api<{ call: typeof liveCall }>(`/conversations/${id}/call`).then((x) => { if (activeIdRef.current === id) setLiveCall(x.call); }).catch(() => setLiveCall(null));
    };
    const conversationsRef = useRef(conversations);
    conversationsRef.current = conversations;

    const open = async (id: number) => {
        setActiveId(id);
        setLiveCall(null);
        setRecording(false);
        setPanel(null);
        setInfoOpen(false);
        setError(null);
        window.history.replaceState(null, '', `/chats/${id}`);
        setReplyTo(null); setEditing(null); setMentioned([]); setSearching(false); setResults(null); setSearchQ(''); setHasNewer(false); setCanDelete(false);
        const r = await api<{ messages: ChatMessage[]; has_more: boolean }>(`/conversations/${id}/messages`);
        setMessages(r.messages);
        setHasMore(r.has_more);
        api<{ conversation: { can: { delete_messages: boolean } } }>(`/conversations/${id}`).then((x) => setCanDelete(x.conversation.can.delete_messages)).catch(() => {});
        const last = r.messages[r.messages.length - 1];
        if (last) api(`/conversations/${id}/read`, { body: { last_read_message_id: last.id } }).then(() => refreshBadges()).catch(() => {});
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
        setTimeout(() => bottom.current?.scrollIntoView(), 50);
        checkCall(id);
    };

    useEffect(() => { if (openConversationId) open(openConversationId); }, [openConversationId]);

    // Something changed (seen by the regular check when the websocket isn't connected, or as a safety net):
    // refresh the list and bring the open chat up to date without losing my place in it.
    useEffect(() => {
        const refresh = async () => {
            loadConversations().catch(() => {});
            const id = activeIdRef.current;
            if (!id) return;
            const r = await api<{ messages: ChatMessage[] }>(`/conversations/${id}/messages`).catch(() => null);
            if (!r || activeIdRef.current !== id) return;
            const nearBottom = (() => { const el = bottom.current?.parentElement; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160; })();
            r.messages.forEach((m) => onIncoming(m));
            const last = r.messages[r.messages.length - 1];
            if (last) api(`/conversations/${id}/read`, { body: { last_read_message_id: last.id } }).catch(() => {});
            if (nearBottom) setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 30);
        };
        const a = onChange('messages', refresh);
        const b = onChange('conversations', () => { loadConversations().catch(() => {}); });
        return () => { a(); b(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // While a group is open, keep its "call in progress" bar up to date.
    useEffect(() => {
        if (!activeId) return;
        const t = window.setInterval(() => checkCall(activeId), 20_000);
        return () => window.clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, conversations.length]);

    /** Puts an emoji where the cursor is in the message box. */
    const addEmoji = (e: string) => {
        const el = input.current;
        const start = el?.selectionStart ?? text.length;
        const end = el?.selectionEnd ?? text.length;
        const next = text.slice(0, start) + e + text.slice(end);
        setText(next);
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + e.length, start + e.length); });
    };
    const sendSticker = (id: string) => {
        setPanel(null);
        send('sticker', stickerById(id)?.label ?? 'Sticker', { sticker: id });
    };

    const sendVoice = async (file: File, seconds: number) => {
        setRecording(false);
        setSendingVoice(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const r = await api<{ path: string; mime: string; size: number }>('/uploads', { form });
            await send('voice', null, { path: r.path, size: r.size, mime: r.mime, duration: seconds });
        } catch (e) {
            setError(`Voice note not sent: ${(e as Error).message}`);
        } finally {
            setSendingVoice(false);
        }
    };

    const loadOlder = async () => {
        if (!activeId || !messages.length) return;
        const r = await api<{ messages: ChatMessage[]; has_more: boolean }>(`/conversations/${activeId}/messages?before=${messages[0].id}`);
        setMessages((prev) => [...r.messages, ...prev]);
        setHasMore(r.has_more);
    };

    const send = async (type: ChatMessage['type'] = 'text', body: string | null = text, meta: Record<string, unknown> | null = null) => {
        if (!activeId || (type === 'text' && !body?.trim())) return;
        if (editing && type === 'text') return saveEdit();
        if (hasNewer) await open(activeId); // jumped back in history: return to the newest messages first
        const clientId = uuid();
        const quote = replyTo;
        const mentions = type === 'text' ? mentioned.filter((p) => body?.includes(`@${p.name}`)).map((p) => p.id) : [];
        const optimistic: ChatMessage = { id: -Date.now(), client_id: clientId, conversation_id: activeId, sender_id: me.id, sender_name: me.name,
            type, body, meta, via: 'online', sent_at: new Date().toISOString(), created_at: new Date().toISOString(), edited: false, deleted: false, pending: true,
            reply_to_id: quote?.id ?? null, reply_to: quote ? { id: quote.id, client_id: quote.client_id, sender_id: quote.sender_id, sender_name: quote.sender_name, type: quote.type, body: quote.body, deleted: false } : null,
            mentions: mentioned.filter((p) => mentions.includes(p.id)) };
        setMessages((p) => [...p, optimistic]);
        if (type === 'text') { setText(''); setMentioned([]); }
        setReplyTo(null);
        setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 20);
        try {
            const r = await api<{ message: ChatMessage }>(`/conversations/${activeId}/messages`, { body: { client_id: clientId, type, body, meta, sent_at: optimistic.sent_at, reply_to_id: quote?.id ?? null, mentions } });
            onIncoming(r.message);
        } catch (e) {
            setError((e as Error).message);
            setMessages((p) => p.filter((m) => m.client_id !== clientId));
        }
    };

    const saveEdit = async () => {
        if (!editing) return;
        const body = text.trim();
        try {
            const r = await api<{ message: ChatMessage }>(`/messages/${editing.id}`, { method: 'PATCH', body: { body } });
            onIncoming(r.message);
            setEditing(null);
            setText('');
        } catch (e) { setError((e as Error).message); }
    };

    const remove = async (m: ChatMessage) => {
        if (!confirm('Delete this message for everyone?')) return;
        try { await api(`/messages/${m.id}`, { method: 'DELETE' }); onIncoming({ ...m, deleted: true, body: null, meta: null }); }
        catch (e) { setError((e as Error).message); }
    };

    const report = async (m: ChatMessage) => {
        const reason = prompt('Why are you reporting this message? Moderators at your institution will review it.');
        if (!reason || reason.trim().length < 5) return;
        try { await api(`/messages/${m.id}/report`, { body: { reason: reason.trim() } }); alert('Reported. Thank you.'); }
        catch (e) { setError((e as Error).message); }
    };

    const startEdit = (m: ChatMessage) => { setEditing(m); setReplyTo(null); setText(m.body ?? ''); setTimeout(() => input.current?.focus(), 10); };
    const startReply = (m: ChatMessage) => { setReplyTo(m); setEditing(null); setTimeout(() => input.current?.focus(), 10); };

    /** Scrolls to a message, loading the part of the history around it first if needed. */
    const jumpTo = async (id: number) => {
        if (!activeId) return;
        if (!messages.some((m) => m.id === id)) {
            const r = await api<{ messages: ChatMessage[]; has_more: boolean; has_newer: boolean }>(`/conversations/${activeId}/messages?around=${id}`);
            setMessages(r.messages);
            setHasMore(r.has_more);
            setHasNewer(r.has_newer);
        }
        setFlash(id);
        setTimeout(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        setTimeout(() => setFlash(null), 2200);
    };

    const runSearch = async (q: string) => {
        setSearchQ(q);
        if (!activeId || q.trim().length < 2) { setResults(null); return; }
        try { setResults((await api<{ results: ChatMessage[] }>(`/conversations/${activeId}/search?q=${encodeURIComponent(q.trim())}`)).results); }
        catch { setResults([]); }
    };

    // "@na" before the cursor: suggest group members to mention.
    const onType = (value: string) => {
        setText(value);
        const caret = input.current?.selectionStart ?? value.length;
        const m = /(?:^|\s)@([\p{L}][\p{L}.' -]{0,30})?$/u.exec(value.slice(0, caret));
        if (!m || !activeId || active?.type === 'direct') { setSuggest(null); return; }
        const query = (m[1] ?? '').trim();
        if (mentioned.some((p) => query.startsWith(p.name))) { setSuggest(null); return; } // already picked; they're typing on
        if (suggestTimer.current) clearTimeout(suggestTimer.current);
        suggestTimer.current = setTimeout(() => api<{ members: Person[] }>(`/conversations/${activeId}/members?q=${encodeURIComponent(query)}`)
            .then((r) => setSuggest({ query: m[0].trimStart(), people: r.members.filter((p) => p.id !== me.id).slice(0, 6) })).catch(() => setSuggest(null)), 200);
    };
    const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pickMention = (p: Person) => {
        if (!suggest) return;
        const caret = input.current?.selectionStart ?? text.length;
        const before = text.slice(0, caret);
        const start = before.lastIndexOf(suggest.query);
        const next = `${text.slice(0, start)}@${p.name} ${text.slice(caret)}`;
        setText(next);
        setMentioned((l) => (l.some((x) => x.id === p.id) ? l : [...l, { id: p.id, name: p.name }]));
        setSuggest(null);
        setTimeout(() => input.current?.focus(), 10);
    };

    const attach = async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        try {
            const r = await api<{ path: string; mime: string; size: number }>('/uploads', { form });
            const type = r.mime.startsWith('image/') ? 'image' : r.mime.startsWith('audio/') ? 'voice' : 'file';
            await send(type, file.name, { path: r.path, size: r.size, mime: r.mime });
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const canPost = !!active?.can_post;
    const unreadChats = conversations.filter((c) => c.unread > 0 && !c.muted && !c.archived).length;
    const unreadCommunities = conversations.some((c) => c.community_id && c.unread > 0 && !c.muted);
    const canVoice = auth!.permissions.includes('calls.voice') && modules?.voice_calls !== false;
    const canVideo = auth!.permissions.includes('calls.video') && modules?.video_calls !== false;
    const groupCalls = modules?.group_calls !== false;
    const voiceNotes = modules?.voice_notes !== false;
    const stickersOn = modules?.stickers !== false;
    const perms = auth!.permissions;
    const canGroup = perms.includes('groups.create');
    const canDirect = perms.includes('chat.direct');
    const canFiles = perms.includes('chat.files');
    const [showArchived, setShowArchived] = useState(false);
    const [menuFor, setMenuFor] = useState<{ id: number; x: number; y: number } | null>(null);
    const matching = filter.trim() ? conversations.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())) : conversations;
    const archived = matching.filter((c) => c.archived);
    const shown = showArchived ? archived : matching.filter((c) => !c.archived);
    const controls = { mute: modules?.mute_chats !== false, archive: modules?.archive_chats !== false, pause: modules?.pause_chats !== false };
    const setChat = async (c: ConversationSummary, body: Record<string, unknown>) => {
        setMenuFor(null);
        try {
            await api(`/conversations/${c.id}`, { method: 'PATCH', body });
            await loadConversations();
            refreshBadges();
            if ('paused' in body && c.id === activeIdRef.current && body.paused === false) open(c.id); // resumed: show what was held back
        } catch (e) { setError((e as Error).message); }
    };
    const communityName = (id: number | null) => communities.find((c) => c.id === id)?.name;

    return (
        <AppLayout title="Chats" hideMobileNav={!!activeId}>
            <Head title={active ? active.name : 'Chats'} />
            {!auth!.permissions.includes('chat.use') ? (
                <div className="flex h-full items-center justify-center p-6">
                    <EmptyState icon={<Lock size={26} />} title="Chat isn't on for your account yet">
                        If you're under 18, your school has to record your parent or guardian's consent first. Otherwise your school
                        controls who can chat. SOS and notices work now; if you think this is wrong, contact your school's ICT unit.
                    </EmptyState>
                </div>
            ) : (<>
            <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
                {/* Conversation list */}
                <section className={`w-full shrink-0 flex-col border-r border-line bg-white md:flex md:w-[340px] ${activeId ? 'hidden' : 'flex'}`}>
                    <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 md:pt-4">
                        <h1 className="text-xl font-bold">{showArchived ? 'Archived' : 'Chats'}</h1>
                        <div className="flex items-center gap-1">
                            {canGroup && <button className="icon-btn" onClick={() => setPicker('group')} aria-label="New group" title="New group"><Users size={20} /></button>}
                            {canDirect && <button className="btn-primary px-3.5 py-1.5 text-sm" onClick={() => setPicker('direct')} title="Find someone to chat with, or send them a chat request"><Plus size={17} />New chat</button>}
                        </div>
                    </div>
                    {communities.length > 0 && (
                        <div className="mx-4 mb-2 flex rounded-full bg-mist p-1 text-sm font-semibold" role="tablist">
                            {(['chats', 'communities'] as const).map((v) => (
                                <button key={v} role="tab" aria-selected={view === v} onClick={() => { setView(v); setCommunityId(null); }}
                                    className={`flex-1 rounded-full py-1.5 ${view === v ? 'bg-white text-grove shadow-[0_1px_2px_rgba(14,59,46,0.12)]' : 'text-muted'}`}>
                                    {v === 'chats' ? 'Chats' : 'Communities'}
                                    {v === 'chats' && unreadChats > 0 && <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sos px-1 align-middle text-[10.5px] text-white">{unreadChats}</span>}
                                    {v === 'communities' && unreadCommunities && <span className="ml-1.5 inline-block size-2 rounded-full bg-sos align-middle" aria-label="new messages" />}
                                </button>
                            ))}
                        </div>
                    )}
                    {view === 'communities' ? (
                        <CommunityBrowser communities={communities} conversations={conversations} openId={communityId} setOpenId={setCommunityId} activeId={activeId} onOpen={open} />
                    ) : (<>
                    <RequestsBar onOpen={async (id) => { await loadConversations(); open(id); }} />
                    <div className="px-4 pb-3">
                        <div className="relative">
                            <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                            <input className="input rounded-full border-transparent bg-mist pl-10" placeholder="Search chats" value={filter} onChange={(e) => setFilter(e.target.value)} />
                        </div>
                    </div>
                    <div className="scroll-area min-h-0 flex-1">
                        {!loaded && Array.from({ length: 7 }, (_, i) => (
                            <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-3" aria-hidden>
                                <span className="size-12 shrink-0 rounded-full bg-mist" />
                                <span className="flex-1 space-y-2"><span className="block h-3.5 w-2/3 rounded bg-mist" /><span className="block h-3 w-1/2 rounded bg-mist/70" /></span>
                            </div>
                        ))}
                        {loaded && shown.length === 0 && (
                            <EmptyState icon={<MessageCircle size={26} />} title={filter ? 'No chats match that name' : 'No conversations yet'}>
                                {!filter && <>Your university, faculty, department and class groups appear here when you sign in.{canDirect && <> To message someone directly, <button className="font-semibold text-leaf underline" onClick={() => setPicker('direct')}>start a chat</button>.</>}</>}
                            </EmptyState>
                        )}
                        {showArchived ? (
                            <button onClick={() => setShowArchived(false)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-leaf hover:bg-mist"><ArrowLeft size={18} />Back to chats</button>
                        ) : archived.length > 0 && (
                            <button onClick={() => setShowArchived(true)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-mist">
                                <span className="flex size-12 shrink-0 items-center justify-center text-leaf"><Archive size={22} /></span>
                                <span className="flex-1 font-semibold">Archived</span>
                                <span className="text-sm text-muted">{archived.length}</span>
                            </button>
                        )}
                        {shown.map((c) => (
                            <div key={c.id} className="group relative">
                            <button onClick={() => open(c.id)} onContextMenu={(e) => { e.preventDefault(); setMenuFor({ id: c.id, x: e.clientX, y: e.clientY }); }}
                                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${c.id === activeId ? 'bg-mint/60' : 'hover:bg-mist'}`}>
                                <ChatIcon c={c} size={48} />
                                <div className="min-w-0 flex-1 border-b border-line/70 pb-2.5">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="truncate font-semibold text-ink">{c.name}</span>
                                        <span className={`shrink-0 text-xs ${c.unread > 0 ? 'font-semibold text-sos' : 'text-muted'}`}>{when(c.last_message_at)}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-center justify-between gap-2">
                                        <span className="truncate text-sm text-muted">
                                            {c.last_message ? <>{c.type !== 'direct' && c.last_message.sender_id !== me.id && `${firstName(c.last_message.sender_name)}: `}{c.last_message.sender_id === me.id && 'You: '}{preview(c.last_message)}</>
                                                : c.type === 'direct' ? 'Say hello' : `${c.member_count} members`}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1 text-muted">
                                            {c.paused_after != null && <PauseCircle size={15} aria-label="Paused" />}
                                            {c.muted && <BellOff size={15} aria-label="Muted" />}
                                            {c.unread > 0 && <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${c.muted || c.archived ? 'bg-muted' : 'bg-sos'}`}>{c.unread >= 100 ? '99+' : c.unread}</span>}
                                        </span>
                                    </div>
                                </div>
                            </button>
                            {(controls.mute || controls.archive || controls.pause) && (
                                <button className="absolute top-1/2 right-2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-muted shadow-sm group-hover:flex focus:flex"
                                    aria-label={`Options for ${c.name}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuFor({ id: c.id, x: r.right, y: r.bottom }); }}>
                                    <ChevronDown size={18} />
                                </button>
                            )}
                            </div>
                        ))}
                    </div>
                    </>)}
                </section>

                {/* Open conversation */}
                <section className={`relative min-w-0 flex-1 flex-col ${activeId ? 'flex' : 'hidden md:flex'}`}>
                    {!active ? (
                        <div className="chat-canvas flex flex-1 items-center justify-center">
                            <div className="max-w-sm px-6 text-center">
                                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-white text-leaf"><Radio size={28} /></div>
                                <p className="text-lg font-semibold text-grove">Pick a chat to start</p>
                                <p className="mt-1 text-sm text-muted">On the phone app, messages keep moving over Wi-Fi and Bluetooth when the internet is down.</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-3 border-b border-line bg-white px-3 py-2.5 md:px-4">
                                <button className="icon-btn -ml-1 md:hidden" onClick={() => { setActiveId(null); window.history.replaceState(null, '', '/chats'); }} aria-label="Back to chats"><ArrowLeft size={22} /></button>
                                <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left hover:bg-mist/60" disabled={active.type === 'direct'}
                                    onClick={() => setInfoOpen(true)} aria-label={active.type === 'direct' ? undefined : `Group info for ${active.name}`} title={active.type === 'direct' ? undefined : 'Group info'}>
                                <ChatIcon c={active} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-semibold text-ink">{active.name}</div>
                                    <div className="truncate text-xs text-muted">
                                        {active.type === 'direct' ? active.peer?.title || 'Private chat'
                                            : [communityName(active.community_id), `${active.member_count} members`, active.posting === 'admins' ? 'only some people can post' : null].filter(Boolean).join(', ')}
                                    </div>
                                </div>
                                </button>
                                <button className="icon-btn" onClick={() => { setSearching(!searching); setResults(null); setSearchQ(''); }} aria-label="Search this chat" title="Search this chat"><Search size={20} /></button>
                                {(controls.mute || controls.archive || controls.pause) && (
                                    <button className="icon-btn order-last" aria-label="Chat options" title="Mute, archive or pause"
                                        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuFor({ id: active.id, x: r.right, y: r.bottom }); }}>
                                        <EllipsisVertical size={20} />
                                    </button>
                                )}
                                {active.peer && (
                                    <div className="flex">
                                        {canVoice && <button className="icon-btn" onClick={() => startCall(active.peer!, 'voice')} aria-label="Voice call" title="Voice call"><Phone size={20} /></button>}
                                        {canVideo && <button className="icon-btn" onClick={() => startCall(active.peer!, 'video')} aria-label="Video call" title="Video call"><Video size={21} /></button>}
                                    </div>
                                )}
                                {!active.peer && canPost && !liveCall && groupCalls && (
                                    <div className="flex">
                                        {canVoice && <button className="icon-btn" onClick={() => startGroupCall(active.id, 'voice')} aria-label="Start a group voice call" title="Group voice call"><Phone size={20} /></button>}
                                        {canVideo && <button className="icon-btn" onClick={() => startGroupCall(active.id, 'video')} aria-label="Start a group video call" title="Group video call"><Video size={21} /></button>}
                                    </div>
                                )}
                            </div>
                            {liveCall && !liveCall.in_call && (
                                <div className="flex items-center gap-3 border-b border-line bg-mint px-3 py-2 md:px-4">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-leaf text-white">{liveCall.type === 'video' ? <Video size={18} /> : <Phone size={17} />}</span>
                                    <div className="min-w-0 flex-1 text-sm">
                                        <div className="font-semibold text-grove">{liveCall.type === 'video' ? 'Video' : 'Voice'} call in progress</div>
                                        <div className="truncate text-muted">{liveCall.participants.map((p) => (p.id === me.id ? 'You' : p.name)).join(', ')}</div>
                                    </div>
                                    <button className="btn-primary shrink-0 px-5" onClick={() => joinGroupCall(liveCall.call_uuid)}>Join</button>
                                </div>
                            )}
                            {searching && (
                                <div className="border-b border-line bg-white px-3 py-2 md:px-4">
                                    <div className="relative">
                                        <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                                        <input autoFocus className="input rounded-full border-transparent bg-mist pr-10 pl-10" placeholder={`Search in ${active.name}`} value={searchQ} onChange={(e) => runSearch(e.target.value)} />
                                        <button className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted" onClick={() => { setSearching(false); setResults(null); }} aria-label="Close search"><X size={18} /></button>
                                    </div>
                                    {results && (
                                        <div className="scroll-area mt-2 max-h-64">
                                            {results.length === 0 && <p className="px-2 py-3 text-sm text-muted">No messages match.</p>}
                                            {results.map((r) => (
                                                <button key={r.id} onClick={() => { jumpTo(r.id); }} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-mist">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex justify-between gap-2 text-xs text-muted"><span className="font-semibold text-ink">{r.sender_id === me.id ? 'You' : r.sender_name}</span><span>{when(r.sent_at)}</span></div>
                                                        <div className="truncate text-sm"><Highlight text={r.body ?? ''} q={searchQ} /></div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {active.paused_after != null && (
                                <div className="flex items-center gap-3 border-b border-line bg-amber/15 px-3 py-2 text-sm md:px-4">
                                    <PauseCircle size={18} className="shrink-0 text-[#7a4d0b]" />
                                    <span className="min-w-0 flex-1">You paused this chat. New messages are held back, with no alerts, until you resume.</span>
                                    <button className="btn-outline shrink-0 px-3 py-1 text-xs" onClick={() => setChat(active, { paused: false })}><PlayCircle size={15} />Resume</button>
                                </div>
                            )}
                            <div className="chat-canvas scroll-area min-h-0 flex-1 px-3 py-4 md:px-8">
                                {hasMore && <button className="btn-outline mx-auto mb-3 block text-xs" onClick={loadOlder}>Show earlier messages</button>}
                                {messages.length === 0 && <p className="mx-auto mt-6 w-fit rounded-full bg-white/80 px-3 py-1 text-xs text-muted">No messages yet. Say hello.</p>}
                                {messages.map((m, i) => {
                                    const prev = messages[i - 1];
                                    const newDay = !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
                                    const grouped = !newDay && prev && prev.sender_id === m.sender_id;
                                    return (
                                        <Fragment key={m.client_id}>
                                            {newDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-muted">{dayLabel(m.sent_at)}</span></div>}
                                            <Bubble m={m} mine={m.sender_id === me.id} showName={active.type !== 'direct' && !grouped} grouped={!!grouped} flash={flash === m.id} meId={me.id}
                                                actions={{
                                                    reply: canPost && m.id > 0 && !m.deleted ? () => startReply(m) : undefined,
                                                    edit: m.sender_id === me.id && m.type === 'text' && m.id > 0 && !m.deleted && Date.now() - new Date(m.created_at).getTime() < 15 * 60_000 ? () => startEdit(m) : undefined,
                                                    remove: m.id > 0 && !m.deleted && (m.sender_id === me.id || canDelete) ? () => remove(m) : undefined,
                                                    report: m.id > 0 && !m.deleted && m.sender_id !== me.id ? () => report(m) : undefined,
                                                    jump: (id) => jumpTo(id),
                                                }} />
                                        </Fragment>
                                    );
                                })}
                                {hasNewer && <button className="btn-primary mx-auto mt-3 block text-xs" onClick={() => open(active.id)}>Jump to latest messages</button>}
                                <div ref={bottom} />
                            </div>
                            {error && <div className="bg-sos/10 px-4 py-2 text-sm text-sos">{error}</div>}
                            {canPost && (replyTo || editing) && (
                                <div className="flex items-center gap-3 border-t border-line bg-white px-4 py-2">
                                    {editing ? <Pencil size={18} className="shrink-0 text-leaf" /> : <Reply size={18} className="shrink-0 text-leaf" />}
                                    <div className="min-w-0 flex-1 border-l-4 border-leaf pl-3">
                                        <div className="text-xs font-semibold text-leaf">{editing ? 'Editing your message' : `Replying to ${replyTo!.sender_id === me.id ? 'yourself' : replyTo!.sender_name}`}</div>
                                        <div className="truncate text-sm text-muted">{preview((editing ?? replyTo)!)}</div>
                                    </div>
                                    <button className="icon-btn" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }} aria-label="Cancel"><X size={18} /></button>
                                </div>
                            )}
                            {canPost && suggest && suggest.people.length > 0 && (
                                <div className="border-t border-line bg-white py-1">
                                    {suggest.people.map((p) => (
                                        <button key={p.id} onClick={() => pickMention(p)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-mist">
                                            <Avatar name={p.name} size={30} /><span className="shrink-0 font-medium">{p.name}</span><span className="truncate text-xs text-muted">{p.title ?? ''}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {canPost && panel && !recording && (
                                <EmojiPanel tab={stickersOn ? panel : 'emoji'} onTab={setPanel} onEmoji={addEmoji} onSticker={sendSticker} onClose={() => setPanel(null)} stickers={stickersOn} />
                            )}
                            {canPost ? (
                                <form className="flex items-end gap-2 bg-mist px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] md:px-4 md:pb-2.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
                                    {recording ? (
                                        <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} onError={(m) => setError(m)} />
                                    ) : (<>
                                    <button type="button" className={`icon-btn shrink-0 ${panel ? 'bg-mint text-leaf' : ''}`} onClick={() => setPanel(panel ? null : 'emoji')}
                                        aria-label="Emojis and stickers" aria-expanded={!!panel} title="Emojis and stickers"><Smile size={21} /></button>
                                    {canFiles && (
                                        <label className="icon-btn shrink-0 cursor-pointer" title="Attach a photo or PDF">
                                            <Paperclip size={21} /><span className="sr-only">Attach</span>
                                            <input type="file" className="hidden" accept="image/*,audio/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f); }} />
                                        </label>
                                    )}
                                    <textarea ref={input} rows={1} className="input max-h-36 min-h-[44px] resize-none rounded-3xl border-transparent py-2.5" maxLength={4000}
                                        placeholder={sendingVoice ? 'Sending voice note…' : 'Message'}
                                        value={text} onChange={(e) => onType(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') { setSuggest(null); setReplyTo(null); if (editing) { setEditing(null); setText(''); } }
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (suggest?.people[0]) pickMention(suggest.people[0]); else send(); }
                                        }} />
                                    {!text.trim() && !editing && voiceNotes && canRecordVoice() ? (
                                        <MicButton onClick={() => { setError(null); setRecording(true); }} disabled={sendingVoice} />
                                    ) : (
                                        <button className="flex size-11 shrink-0 items-center justify-center rounded-full bg-leaf text-white transition-colors hover:bg-leaf-dark disabled:opacity-40" disabled={!text.trim()} aria-label={editing ? 'Save' : 'Send'}>
                                            {editing ? <Check size={20} /> : <SendHorizontal size={20} />}
                                        </button>
                                    )}
                                    </>)}
                                </form>
                            ) : (
                                <div className="flex items-center justify-center gap-2 bg-mist px-4 py-3 text-center text-sm text-muted"><Lock size={15} />{active.auto_type === 'announcements' ? 'Only people allowed to post notices can write here.' : 'Only group admins can post in this group.'}</div>
                            )}
                        </>
                    )}
                    {infoOpen && active && active.type !== 'direct' && (
                        <GroupInfo conversationId={active.id} meId={me.id} onClose={() => setInfoOpen(false)}
                            onLeft={() => { setInfoOpen(false); setActiveId(null); window.history.replaceState(null, '', '/chats'); loadConversations().catch(() => {}); }} />
                    )}
                </section>
            </div>
            {menuFor && (() => {
                const c = conversations.find((x) => x.id === menuFor.id);
                return c ? <ChatMenu c={c} x={menuFor.x} y={menuFor.y} controls={controls} onClose={() => setMenuFor(null)} onSet={(b) => setChat(c, b)} /> : null;
            })()}
            {picker && <PeoplePicker mode={picker} onClose={() => setPicker(null)} onDone={async (id) => { setPicker(null); await loadConversations(); open(id); }} />}
            </>)}
        </AppLayout>
    );
}

const firstName = (n?: string) => (n ?? '').split(' ')[0];

/** Announcement channels get a megaphone, private chats a face, groups their initials. */
function ChatIcon({ c, size }: { c: ConversationSummary; size: number }) {
    if (c.auto_type === 'announcements') {
        return <span className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-grove text-white" style={{ width: size, height: size }}><Megaphone size={size * 0.45} /></span>;
    }
    return <Avatar name={c.name} group={c.type !== 'direct'} size={size} />;
}

/**
 * Communities like WhatsApp: the university, then faculties, then departments. Each shows the groups
 * inside it that you belong to, and the communities inside it.
 */
function CommunityBrowser({ communities, conversations, openId, setOpenId, activeId, onOpen }: {
    communities: Community[]; conversations: ConversationSummary[]; openId: number | null; setOpenId: (id: number | null) => void;
    activeId: number | null; onOpen: (id: number) => void;
}) {
    const ids = new Set(communities.map((c) => c.id));
    const roots = communities.filter((c) => !c.parent_id || !ids.has(c.parent_id));
    const current = communities.find((c) => c.id === openId) ?? null;
    const children = current ? communities.filter((c) => c.parent_id === current.id) : roots;
    const groups = current ? conversations.filter((c) => c.community_id === current.id)
        .sort((a, b) => (a.auto_type === 'announcements' ? -1 : b.auto_type === 'announcements' ? 1 : a.name.localeCompare(b.name))) : [];
    // Unread in a community = unread in its groups and in every community inside it.
    const unreadIn = (id: number): number => conversations.filter((x) => x.community_id === id).reduce((n, x) => n + (x.muted ? 0 : x.unread), 0)
        + communities.filter((x) => x.parent_id === id).reduce((n, x) => n + unreadIn(x.id), 0);
    const trail: Community[] = [];
    for (let c = current; c; c = communities.find((x) => x.id === c!.parent_id) ?? null) trail.unshift(c);

    return (
        <div className="scroll-area min-h-0 flex-1">
            {current && (
                <div className="border-b border-line px-4 pb-3">
                    <button className="mb-2 flex items-center gap-1 text-sm font-semibold text-leaf" onClick={() => setOpenId(current.parent_id && ids.has(current.parent_id) ? current.parent_id : null)}>
                        <ArrowLeft size={16} />{trail.length > 1 ? trail[trail.length - 2].name : 'All communities'}
                    </button>
                    <div className="flex items-center gap-3">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-mint text-leaf"><UsersRound size={24} /></span>
                        <div className="min-w-0">
                            <div className="truncate text-lg font-bold text-grove">{current.name}</div>
                            <div className="truncate text-xs text-muted">{current.description ?? `${current.member_count} members`}</div>
                        </div>
                    </div>
                </div>
            )}
            {groups.map((c) => (
                <button key={c.id} onClick={() => onOpen(c.id)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${c.id === activeId ? 'bg-mint/60' : 'hover:bg-mist'}`}>
                    <ChatIcon c={c} size={42} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{c.name}</div>
                        <div className="truncate text-sm text-muted">{c.last_message ? `${firstName(c.last_message.sender_name)}: ${c.last_message.body ?? 'Attachment'}` : `${c.member_count} members`}</div>
                    </div>
                    {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sos px-1.5 text-[11px] font-bold text-white">{c.unread > 99 ? '99+' : c.unread}</span>}
                </button>
            ))}
            {children.length > 0 && current && <div className="px-4 pt-4 pb-1 text-sm font-semibold text-muted">Inside {current.name}</div>}
            {children.map((c) => (
                <button key={c.id} onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-mist">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-mint text-leaf"><UsersRound size={21} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{c.name}</div>
                        <div className="truncate text-sm text-muted">{communities.filter((x) => x.parent_id === c.id).length || conversations.filter((x) => x.community_id === c.id).length} inside</div>
                    </div>
                    {unreadIn(c.id) > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sos px-1.5 text-[11px] font-bold text-white">{unreadIn(c.id) > 99 ? '99+' : unreadIn(c.id)}</span>}
                    <ChevronRight size={18} className="text-muted" />
                </button>
            ))}
            {!current && roots.length === 0 && <EmptyState icon={<UsersRound size={26} />} title="No communities yet">They appear after your first sign-in.</EmptyState>}
        </div>
    );
}

function dayLabel(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function preview(m: ChatMessage) {
    if (m.deleted) return 'Message deleted';
    if (m.type === 'sticker') return `${stickerById(m.meta?.sticker as string)?.emoji ?? ''} Sticker`;
    return m.type === 'text' || m.type === 'system' ? m.body : m.type === 'image' ? 'Photo' : m.type === 'voice' ? 'Voice note' : 'File';
}

type Actions = { reply?: () => void; edit?: () => void; remove?: () => void; report?: () => void; jump: (id: number) => void };

/** Marks the search term inside a result. */
function Highlight({ text, q }: { text: string; q: string }) {
    const i = q.trim() ? text.toLowerCase().indexOf(q.trim().toLowerCase()) : -1;
    if (i < 0) return <>{text}</>;
    const start = Math.max(0, i - 40);
    return <>{start > 0 && '…'}{text.slice(start, i)}<mark className="rounded bg-amber/40 px-0.5">{text.slice(i, i + q.trim().length)}</mark>{text.slice(i + q.trim().length)}</>;
}

/** Message text with @mentions in bold green (and "you" highlighted). */
function MessageText({ body, mentions, meId }: { body: string; mentions?: { id: number; name: string }[]; meId: number }) {
    if (!mentions?.length) return <p className="break-words whitespace-pre-wrap">{body}</p>;
    const names = mentions.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const parts = body.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
    return (
        <p className="break-words whitespace-pre-wrap">
            {parts.map((part, k) => {
                const who = mentions.find((m) => part === `@${m.name}`);
                return who ? <span key={k} className={`font-semibold text-leaf ${who.id === meId ? 'rounded bg-amber/30 px-0.5' : ''}`}>{part}</span> : <Fragment key={k}>{part}</Fragment>;
            })}
        </p>
    );
}

function Bubble({ m, mine, showName, grouped, flash, meId, actions }: { m: ChatMessage; mine: boolean; showName: boolean; grouped: boolean; flash: boolean; meId: number; actions: Actions }) {
    const path = (m.meta?.path as string | undefined) ?? null;
    const legacyUrl = (m.meta?.legacy_url as string | undefined) ?? null;
    const corner = grouped ? '' : mine ? 'rounded-tr-md' : 'rounded-tl-md';
    const [menu, setMenu] = useState(false);
    if (m.type === 'system') return <SystemNote m={m} meId={meId} />;
    const sticker = m.type === 'sticker' && !m.deleted;
    const statusReply = m.meta?.status_reply as { preview?: string; media_path?: string | null; background?: string | null } | undefined;
    const items = ([
        ['Reply', Reply, actions.reply], ['Edit', Pencil, actions.edit], ['Report', Flag, actions.report], ['Delete for everyone', Trash2, actions.remove],
    ] as const).filter(([, , fn]) => fn);
    return (
        <div id={m.id > 0 ? `msg-${m.id}` : undefined} className={`group flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-2.5'}`} onDoubleClick={actions.reply}>
            <div className={`relative max-w-[min(78%,560px)] rounded-2xl px-3 pt-1.5 pb-1 text-[15px] transition-shadow ${corner} ${sticker ? 'bg-transparent' : `shadow-[0_1px_1px_rgba(14,59,46,0.08)] ${mine ? 'bg-mint' : 'bg-white'}`} ${m.pending ? 'opacity-80' : ''} ${flash ? 'ring-4 ring-amber/60' : ''}`}>
                {items.length > 0 && (
                    <button onClick={() => setMenu(!menu)} aria-label="Message options"
                        className={`absolute top-1 right-1 rounded-full p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 ${mine ? 'bg-mint' : 'bg-white'} ${menu ? 'opacity-100' : ''}`}>
                        <ChevronDown size={18} />
                    </button>
                )}
                {menu && (
                    <div className={`absolute top-7 z-20 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-line ${mine ? 'right-0' : 'left-0'}`} onMouseLeave={() => setMenu(false)}>
                        {items.map(([label, IconC, fn]) => (
                            <button key={label} onClick={() => { setMenu(false); fn!(); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-mist ${label.startsWith('Delete') ? 'text-sos' : 'text-ink'}`}>
                                <IconC size={16} />{label}
                            </button>
                        ))}
                    </div>
                )}
                {showName && !mine && <div className="mb-0.5 text-[13px] font-semibold text-leaf">{m.sender_name}</div>}
                {m.reply_to && !m.deleted && (
                    <button onClick={() => actions.jump(m.reply_to!.id)} className="mb-1 block w-full rounded-lg border-l-4 border-leaf bg-black/5 px-2 py-1 text-left">
                        <div className="text-xs font-semibold text-leaf">{m.reply_to.sender_id === meId ? 'You' : m.reply_to.sender_name}</div>
                        <div className="line-clamp-2 text-[13px] text-muted">{m.reply_to.deleted ? 'Deleted message' : m.reply_to.type === 'text' ? m.reply_to.body : m.reply_to.type === 'image' ? 'Photo' : m.reply_to.type === 'voice' ? 'Voice note' : (m.reply_to.body ?? 'File')}</div>
                    </button>
                )}
                {statusReply && !m.deleted && (
                    <a href="/status" className="mb-1 flex items-center gap-2 rounded-lg border-l-4 border-leaf bg-black/5 px-2 py-1">
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-leaf">{mine ? 'You replied to their status' : 'Replied to your status'}</span>
                            <span className="line-clamp-2 text-[13px] text-muted">{statusReply.preview}</span>
                        </span>
                        {statusReply.media_path
                            ? <img src={fileUrl(statusReply.media_path)} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                            : <span className="size-10 shrink-0 rounded-md" style={{ background: statusReply.background ?? '#0e3b2e' }} />}
                    </a>
                )}
                {m.deleted ? <em className="text-muted">This message was deleted</em>
                    : m.type === 'sticker' ? <StickerView id={m.meta?.sticker as string} />
                    : m.type === 'image' && path ? <img src={fileUrl(path)} alt={m.body ?? 'Photo'} className="my-1 max-h-80 rounded-xl" loading="lazy" />
                    : m.type === 'voice' && path ? <VoicePlayer src={fileUrl(path)} seconds={(m.meta?.duration as number | undefined) ?? null} mine={mine} />
                    : m.type === 'file' && path ? <a className="my-1 flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 font-medium" href={fileUrl(path)}><FileText size={18} />{m.body ?? 'Download file'}</a>
                    : <MessageText body={m.body ?? ''} mentions={m.mentions} meId={meId} />}
                {legacyUrl && !m.deleted && <a href={legacyUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-leaf underline">Open the original file</a>}
                <div className="flex items-center justify-end gap-1 text-[11px] leading-5 text-muted">
                    {m.mentions?.some((x) => x.id === meId) && <AtSign size={12} className="text-leaf" aria-label="Mentions you" />}
                    {m.via !== 'online' && <span title="Delivered over the offline network" className="inline-flex items-center gap-0.5"><Radio size={12} />offline</span>}
                    {m.edited && <span>edited</span>}
                    <span>{new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {mine && (m.pending ? <Clock size={13} aria-label="Sending" /> : m.id > 0 ? <CheckCheck size={15} className="text-leaf" aria-label="Sent" /> : <Check size={14} />)}
                </div>
            </div>
        </div>
    );
}

/** A notice in the chat, e.g. a group call card with a Join button while the call is running. */
function SystemNote({ m, meId }: { m: ChatMessage; meId: number }) {
    const call = m.meta?.call as { uuid: string; type: 'voice' | 'video'; ended?: boolean; duration_s?: number } | undefined;
    if (!call) {
        return <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-center text-xs text-muted">{m.body}</span></div>;
    }
    const mins = call.duration_s ? Math.max(1, Math.round(call.duration_s / 60)) : null;
    return (
        <div className="my-3 flex justify-center">
            <div className="flex max-w-full items-center gap-3 rounded-2xl bg-white px-3 py-2 shadow-[0_1px_1px_rgba(14,59,46,0.08)]">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${call.ended ? 'bg-mist text-muted' : 'bg-leaf text-white'}`}>
                    {call.type === 'video' ? <Video size={17} /> : <Phone size={16} />}
                </span>
                <div className="min-w-0 text-sm">
                    <div className="font-semibold">{call.type === 'video' ? 'Video' : 'Voice'} call{call.ended ? ' ended' : ''}</div>
                    <div className="text-xs text-muted">
                        {m.sender_id === meId ? 'You' : m.sender_name} started it · {new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{mins ? ` · ${mins} min` : ''}
                    </div>
                </div>
                {!call.ended && <button className="btn-primary ml-1 shrink-0 px-4 py-1.5" onClick={() => joinGroupCall(call.uuid)}>Join</button>}
            </div>
        </div>
    );
}

type Reach = 'direct' | 'request' | 'requested' | 'accept' | 'none';
type Found = Person & { reach?: Reach; request_id?: number | null; reach_note?: string | null };

/**
 * Find people and start a chat. Who you can message straight away follows your institution's rules; for anyone
 * else you send a chat request (with a short note) and the chat opens when they accept.
 */
function PeoplePicker({ mode, onClose, onDone }: { mode: 'direct' | 'group'; onClose: () => void; onDone: (id: number) => void }) {
    const [q, setQ] = useState('');
    const [who, setWho] = useState<'' | 'student' | 'staff'>('');
    const [people, setPeople] = useState<Found[]>([]);
    const [searched, setSearched] = useState(false);
    const [chosen, setChosen] = useState<Found[]>([]);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [asking, setAsking] = useState<Found | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<number | null>(null);

    const search = useCallback(() => {
        if (q.trim().length < 2) { setPeople([]); setSearched(false); return; }
        api<{ people: Found[] }>(`/directory?q=${encodeURIComponent(q.trim())}${who ? `&type=${who}` : ''}`)
            .then((r) => { setPeople(r.people); setSearched(true); }).catch((e) => setError(e.message));
    }, [q, who]);
    useEffect(() => { const t = setTimeout(search, 300); return () => clearTimeout(t); }, [search]);

    const set = (id: number, patch: Partial<Found>) => setPeople((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const run = async (p: Found, fn: () => Promise<void>) => {
        setBusy(p.id); setError(null);
        try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
    };
    const chat = (p: Found) => run(p, async () => {
        const r = await api<{ conversation_id: number }>('/conversations/direct', { body: { user_id: p.id } });
        onDone(r.conversation_id);
    });
    const sendRequest = (p: Found) => run(p, async () => {
        const r = await api<{ request?: { id: number }; conversation_id?: number }>('/chat-requests', { body: { user_id: p.id, message: note.trim() || null } });
        if (r.conversation_id) { onDone(r.conversation_id); return; }
        set(p.id, { reach: 'requested', request_id: r.request?.id ?? null });
        setAsking(null); setNote('');
    });
    const cancel = (p: Found) => run(p, async () => {
        await api(`/chat-requests/${p.request_id}`, { method: 'DELETE' });
        set(p.id, { reach: 'request', request_id: null });
    });
    const accept = (p: Found) => run(p, async () => {
        const r = await api<{ conversation_id: number }>(`/chat-requests/${p.request_id}/accept`, { method: 'POST' });
        onDone(r.conversation_id);
    });
    const createGroup = async () => {
        try {
            const r = await api<{ conversation_id: number; skipped: number[] }>('/conversations/group', { body: { name, member_ids: chosen.map((c) => c.id) } });
            onDone(r.conversation_id);
        } catch (e) { setError((e as Error).message); }
    };
    const toggle = (p: Found) => setChosen((c) => (c.some((x) => x.id === p.id) ? c.filter((x) => x.id !== p.id) : [...c, p]));

    const action = (p: Found) => {
        const r = p.reach ?? 'direct';
        if (mode === 'group') {
            return r === 'direct'
                ? <span className={`text-xs font-semibold ${chosen.some((x) => x.id === p.id) ? 'text-leaf' : 'text-muted'}`}>{chosen.some((x) => x.id === p.id) ? 'Added' : 'Add'}</span>
                : <span className="text-xs text-muted">Needs a chat request first</span>;
        }
        if (r === 'direct') return <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === p.id} onClick={() => chat(p)}>Chat</button>;
        if (r === 'request') return <button className="btn-outline px-3 py-1.5 text-xs" disabled={busy === p.id} onClick={() => { setAsking(p); setNote(''); }}>Request</button>;
        if (r === 'requested') return <button className="btn-ghost px-3 py-1.5 text-xs text-muted" disabled={busy === p.id} onClick={() => cancel(p)} title="Cancel your request">Requested ✕</button>;
        if (r === 'accept') return <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === p.id} onClick={() => accept(p)}>Accept</button>;
        return <span className="max-w-32 text-right text-xs text-muted">{p.reach_note ?? "Can't be reached here"}</span>;
    };

    return (
        <Modal title={mode === 'direct' ? 'New chat' : 'New group'} onClose={onClose}>
            <div className="space-y-3">
                {mode === 'group' && (
                    <div>
                        <label className="label" htmlFor="group-name">Group name</label>
                        <input id="group-name" className="input" placeholder="Project team" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                )}
                <div className="relative">
                    <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                    <input className="input pl-10" autoFocus placeholder="Search by name, matric or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="flex gap-1.5" role="radiogroup" aria-label="Who to search">
                    {([['', 'Everyone'], ['student', 'Students'], ['staff', 'Staff']] as const).map(([v, l]) => (
                        <button key={v} role="radio" aria-checked={who === v} onClick={() => setWho(v)}
                            className={`rounded-full px-3 py-1 text-sm font-medium ${who === v ? 'bg-grove text-white' : 'bg-mist text-ink hover:bg-mint'}`}>{l}</button>
                    ))}
                </div>
                {mode === 'group' && chosen.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {chosen.map((c) => <button key={c.id} onClick={() => toggle(c)} className="pill bg-mint text-grove">{c.name} ×</button>)}
                    </div>
                )}

                {asking && (
                    <div className="rounded-2xl border border-line p-3">
                        <p className="text-sm"><strong>{asking.name}</strong> needs to accept before you can chat or call. Say who you are and why (optional):</p>
                        <textarea className="input mt-2 resize-none" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
                            placeholder="Hi, I'm in your 200 level class. Can we talk about the group project?" />
                        <div className="mt-2 flex justify-end gap-2">
                            <button className="btn-ghost" onClick={() => setAsking(null)}>Cancel</button>
                            <button className="btn-primary" disabled={busy === asking.id} onClick={() => sendRequest(asking)}>Send request</button>
                        </div>
                    </div>
                )}

                <div className="scroll-area -mx-2 max-h-72 min-h-24">
                    {q.trim().length < 2 && <p className="px-2 py-6 text-center text-sm text-muted">Type at least two letters of a name, or a full matric or staff number.</p>}
                    {searched && people.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">Nobody found. People appear here after they first sign in.</p>}
                    {people.map((p) => {
                        const picked = chosen.some((x) => x.id === p.id);
                        const canPick = mode === 'group' && (p.reach ?? 'direct') === 'direct';
                        return (
                            <div key={p.id} role={canPick ? 'button' : undefined} tabIndex={canPick ? 0 : undefined}
                                onClick={canPick ? () => toggle(p) : undefined} onKeyDown={canPick ? (e) => e.key === 'Enter' && toggle(p) : undefined}
                                className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${canPick ? 'cursor-pointer hover:bg-mist' : ''} ${picked ? 'bg-mint/60' : ''}`}>
                                <Avatar name={p.name} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{p.name}</div>
                                    <div className="truncate text-xs text-muted">{[p.title || memberLabel(p.member_type), p.department, p.level ? `${p.level} level` : null].filter(Boolean).join(', ')}</div>
                                </div>
                                <div className="shrink-0">{action(p)}</div>
                            </div>
                        );
                    })}
                </div>
                {error && <p role="alert" className="text-sm text-sos">{error}</p>}
                {mode === 'group' && (
                    <button className="btn-primary w-full py-2.5" disabled={!name.trim() || chosen.length === 0} onClick={createGroup}>
                        Create group{chosen.length > 0 ? ` with ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}` : ''}
                    </button>
                )}
            </div>
        </Modal>
    );
}

type ChatReq = { id: number; message: string | null; created_at: string; person: Person };

/** People asking to chat with me, at the top of the chat list. */
function RequestsBar({ onOpen }: { onOpen: (conversationId: number) => void }) {
    const [incoming, setIncoming] = useState<ChatReq[]>([]);
    const [answers, setAnswers] = useState<(ChatReq & { conversation_id: number | null; status: string })[]>([]);
    const [open, setOpen] = useState(false);
    const load = useCallback(() => {
        api<{ incoming: ChatReq[]; responses?: (ChatReq & { conversation_id: number | null; status: string })[] }>('/chat-requests')
            .then((r) => { setIncoming(r.incoming); setAnswers(r.responses ?? []); }).catch(() => {});
    }, []);
    useEffect(() => {
        load();
        const offs = ['received', 'updated', 'accepted', 'declined'].map((k) => listenUser(`chat_request.${k}`, load)).concat(onChange('conversations', load));
        return () => offs.forEach((f) => f());
    }, [load]);
    const seen = (ids: number[]) => {
        setAnswers((l) => l.filter((x) => !ids.includes(x.id)));
        api('/chat-requests/responses/seen', { body: { ids } }).then(() => refreshBadges()).catch(() => {});
    };
    const answerList = answers.length > 0 && (
        <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-line bg-white">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-sm font-semibold text-grove">
                <span className="flex-1">Answers to your chat requests</span>
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sos px-1.5 text-[11px] font-bold text-white">{answers.length}</span>
            </div>
            {answers.map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-t border-line/60 px-3 py-2">
                    <Avatar name={r.person.name} size={34} />
                    <div className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold">{r.person.name}</span>{' '}
                        {r.status === 'accepted' ? <span className="text-leaf">accepted. You can chat and call now.</span> : <span className="text-muted">can't chat right now.</span>}
                    </div>
                    {r.status === 'accepted' && r.conversation_id
                        ? <button className="btn-primary shrink-0 px-3 py-1 text-xs" onClick={() => { seen([r.id]); onOpen(r.conversation_id!); }}>Open chat</button>
                        : <button className="icon-btn shrink-0" aria-label="Dismiss" onClick={() => seen([r.id])}><X size={16} /></button>}
                </div>
            ))}
        </div>
    );
    if (!incoming.length) return answerList || null;
    const answer = async (r: ChatReq, yes: boolean) => {
        const res = await api<{ conversation_id?: number }>(`/chat-requests/${r.id}/${yes ? 'accept' : 'decline'}`, { method: 'POST' }).catch(() => null);
        setIncoming((l) => l.filter((x) => x.id !== r.id));
        if (yes && res?.conversation_id) onOpen(res.conversation_id);
    };
    return (
        <>
        {answerList}
        <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-leaf/30 bg-mint/50">
            <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-grove" onClick={() => setOpen(!open)} aria-expanded={open}>
                <UserPlus size={17} /><span className="flex-1">Chat requests</span>
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sos px-1.5 text-[11px] font-bold text-white">{incoming.length}</span>
                <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
            </button>
            {open && incoming.map((r) => (
                <div key={r.id} className="flex items-start gap-3 border-t border-leaf/15 bg-white px-3 py-2.5">
                    <Avatar name={r.person.name} size={38} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.person.name}</div>
                        <div className="truncate text-xs text-muted">{[r.person.title || memberLabel(r.person.member_type), r.person.department].filter(Boolean).join(', ')}</div>
                        {r.message && <p className="mt-1 text-sm break-words">{r.message}</p>}
                        <div className="mt-2 flex gap-2">
                            <button className="btn-primary px-3 py-1 text-xs" onClick={() => answer(r, true)}>Accept</button>
                            <button className="btn-ghost px-3 py-1 text-xs" onClick={() => answer(r, false)}>Decline</button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
        </>
    );
}

/** Mute (8 hours, a week, always), archive and pause for one chat. Each can be switched off by the institution. */
function ChatMenu({ c, x, y, controls, onClose, onSet }: {
    c: ConversationSummary; x: number; y: number; controls: { mute: boolean; archive: boolean; pause: boolean };
    onClose: () => void; onSet: (body: Record<string, unknown>) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        setTimeout(() => document.addEventListener('mousedown', away));
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
    }, [onClose]);
    const left = Math.max(8, Math.min(x - 232, window.innerWidth - 248));
    const top = Math.min(y + 4, window.innerHeight - 300);
    const row = 'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-mist';
    const until = c.muted_until ? new Date(c.muted_until) : null;
    return (
        <div ref={ref} role="menu" aria-label={`Options for ${c.name}`} style={{ left, top }}
            className="fade-in fixed z-50 w-60 rounded-2xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(14,59,46,0.18)]">
            {controls.mute && (c.muted ? (
                <button role="menuitem" className={row} onClick={() => onSet({ muted: false })}>
                    <BellOff size={17} className="text-muted" /><span>Unmute{until ? <span className="block text-xs text-muted">Muted until {until.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}</span>
                </button>
            ) : (<>
                <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-muted uppercase">Mute alerts</div>
                <div className="flex gap-1 px-2 pb-1.5">
                    {([[8, '8 hours'], [168, '1 week'], [null, 'Always']] as const).map(([h, label]) => (
                        <button key={label} role="menuitem" className="flex-1 rounded-lg bg-mist px-1 py-1.5 text-xs font-medium hover:bg-mint" onClick={() => onSet({ muted: true, mute_hours: h })}>{label}</button>
                    ))}
                </div>
            </>))}
            {controls.archive && (
                <button role="menuitem" className={row} onClick={() => onSet({ archived: !c.archived })}>
                    {c.archived ? <><ArchiveRestore size={17} className="text-muted" />Unarchive</> : <><Archive size={17} className="text-muted" />Archive</>}
                </button>
            )}
            {controls.pause && (
                <button role="menuitem" className={row} onClick={() => onSet({ paused: c.paused_after == null })}>
                    {c.paused_after != null ? <><PlayCircle size={17} className="text-muted" />Resume messages</>
                        : <><PauseCircle size={17} className="text-muted" /><span>Pause messages<span className="block text-xs text-muted">Hold new messages until you resume</span></span></>}
                </button>
            )}
        </div>
    );
}
