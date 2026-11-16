import { api } from '@/lib/api';
import { listenUser } from '@/lib/live';
import { ArrowLeft, Headset, Loader2, Plus, Search, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './ui';

type Person = { id: number; name: string; where: string; platform: boolean };
type Thread = { id: number; is_group: boolean; name: string; where: string; people: Person[]; last: { body: string; mine: boolean; at: string } | null; unread: number };
type Msg = { id: number; body: string; at: string; mine: boolean; from: string };

const time = (s: string) => {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? '' : d.toDateString() === new Date().toDateString()
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/**
 * Floating chat for the platform team and school admins (bottom right of every page of the website).
 * Platform owners talk to each other and to any school's admins; school admins talk to the platform team.
 */
/**
 * lifted: leave room for a message box at the bottom (chat pages). On phone-size screens there is no floating button
 * (it would cover buttons): the page's top bar has the chat button instead and opens this with the 'sos:platform-chat' event.
 */
export function PlatformChat({ lifted = false }: { lifted?: boolean }) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'list' | 'new' | number>('list');
    const [threads, setThreads] = useState<Thread[]>([]);
    const [unread, setUnread] = useState(0);
    const [platform, setPlatform] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await api<{ threads: Thread[]; unread: number; platform: boolean }>('/platform-chat');
            setThreads(r.threads); setUnread(r.unread); setPlatform(r.platform); setError(null);
            window.dispatchEvent(new CustomEvent('sos:platform-chat-unread', { detail: r.unread }));
        } catch (e) { setError((e as Error).message); }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const openIt = () => { setOpen(true); load(); };
        window.addEventListener('sos:platform-chat', openIt);
        return () => window.removeEventListener('sos:platform-chat', openIt);
    }, [load]);
    useEffect(() => listenUser('platform.message', () => load()), [load]);
    // Safety net when live updates are down: check every 20 s while open, every 60 s while closed.
    useEffect(() => { const t = window.setInterval(load, open ? 20_000 : 60_000); return () => window.clearInterval(t); }, [load, open]);

    const active = typeof view === 'number' ? threads.find((t) => t.id === view) : undefined;

    return (
        <>
            {!open && (
                <button
                    onClick={() => { setOpen(true); load(); }}
                    className={`fixed right-6 z-40 hidden size-14 items-center justify-center rounded-full bg-grove text-white shadow-[0_8px_24px_rgba(14,59,46,0.35)] transition hover:scale-105 md:flex ${lifted ? 'bottom-24' : 'bottom-6'}`}
                    aria-label={unread ? `Platform chat, ${unread} unread` : 'Platform chat'}
                    title="Platform chat"
                >
                    <Headset size={24} />
                    {unread > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-amber px-1.5 text-xs font-bold text-ink">
                            {unread > 99 ? '99+' : unread}
                        </span>
                    )}
                </button>
            )}
            {open && (
                <div
                    role="dialog" aria-label="Platform chat"
                    className="fade-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-white md:inset-auto md:bottom-6 md:right-6 md:h-[min(620px,calc(100dvh-3rem))] md:w-[380px] md:rounded-2xl md:border md:border-line md:shadow-[0_16px_40px_rgba(14,59,46,0.25)]"
                >
                    <header className="flex items-center gap-2 bg-grove px-3 py-3 text-white">
                        {view !== 'list' && (
                            <button onClick={() => { setView('list'); load(); }} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Back"><ArrowLeft size={20} /></button>
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{active ? active.name : view === 'new' ? 'New conversation' : 'Platform chat'}</p>
                            <p className="truncate text-xs text-white/70">
                                {active ? active.where : view === 'new' ? (platform ? 'Platform team and school admins' : 'The platform team') : platform ? 'Platform team and school admins' : 'Talk to the platform team'}
                            </p>
                        </div>
                        {view === 'list' && (
                            <button onClick={() => setView('new')} className="rounded-full p-1.5 hover:bg-white/10" aria-label="New conversation" title="New conversation"><Plus size={20} /></button>
                        )}
                        <button onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Close"><X size={20} /></button>
                    </header>
                    {error && <p className="bg-amber/15 px-3 py-2 text-sm text-ink">{error}</p>}
                    {view === 'list' && <ThreadList threads={threads} onOpen={setView} onNew={() => setView('new')} platform={platform} />}
                    {view === 'new' && <NewChat platform={platform} onStarted={async (id) => { await load(); setView(id); }} />}
                    {typeof view === 'number' && <Conversation key={view} id={view} onActivity={load} />}
                </div>
            )}
        </>
    );
}

function ThreadList({ threads, onOpen, onNew, platform }: { threads: Thread[]; onOpen: (id: number) => void; onNew: () => void; platform: boolean }) {
    if (!threads.length) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <Headset size={32} className="text-leaf" />
                <p className="font-semibold text-grove">No conversations yet</p>
                <p className="max-w-[30ch] text-sm text-muted">
                    {platform ? 'Message another platform owner or any school’s admins.' : 'Need help with your school’s setup? Message the platform team.'}
                </p>
                <button onClick={onNew} className="rounded-full bg-grove px-4 py-2 text-sm font-semibold text-white">Start a conversation</button>
            </div>
        );
    }
    return (
        <ul className="scroll-area flex-1 overflow-y-auto">
            {threads.map((t) => (
                <li key={t.id}>
                    <button onClick={() => onOpen(t.id)} className="flex w-full items-center gap-3 border-b border-line/60 px-3 py-3 text-left hover:bg-mist">
                        <Avatar name={t.name} size={42} group={t.is_group} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <p className={`min-w-0 flex-1 truncate ${t.unread ? 'font-bold text-ink' : 'font-semibold text-grove'}`}>{t.name}</p>
                                {t.last && <span className="shrink-0 text-xs text-muted">{time(t.last.at)}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-sm text-muted">
                                    {t.last ? `${t.last.mine ? 'You: ' : ''}${t.last.body}` : t.where}
                                </p>
                                {t.unread > 0 && <span className="shrink-0 rounded-full bg-leaf px-1.5 text-xs font-bold text-white">{t.unread}</span>}
                            </div>
                        </div>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function NewChat({ platform, onStarted }: { platform: boolean; onStarted: (id: number) => void }) {
    const [q, setQ] = useState('');
    const [people, setPeople] = useState<Person[]>([]);
    const [picked, setPicked] = useState<Person[]>([]);
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const t = window.setTimeout(() => {
            api<{ people: Person[] }>(`/platform-chat/people?q=${encodeURIComponent(q)}`).then((r) => setPeople(r.people)).catch((e) => setError(e.message));
        }, 250);
        return () => window.clearTimeout(t);
    }, [q]);

    const start = async (who: Person[]) => {
        setBusy(true); setError(null);
        try {
            const r = await api<{ id: number }>('/platform-chat', { body: { user_ids: who.map((p) => p.id), title: who.length > 1 ? title || null : null } });
            onStarted(r.id);
        } catch (e) { setError((e as Error).message); setBusy(false); }
    };
    const toggle = (p: Person) => setPicked((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-line p-3">
                <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 focus-within:border-leaf">
                    <Search size={16} className="text-muted" />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        placeholder={platform ? 'Search name, email or school' : 'Search the platform team'} />
                </label>
                {platform && picked.length > 0 && (
                    <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            {picked.map((p) => (
                                <button key={p.id} onClick={() => toggle(p)} className="flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-xs text-grove">{p.name} <X size={12} /></button>
                            ))}
                        </div>
                        {picked.length > 1 && (
                            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Group name (optional)"
                                className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-leaf" />
                        )}
                        <button disabled={busy} onClick={() => start(picked)} className="w-full rounded-full bg-grove py-2 text-sm font-semibold text-white disabled:opacity-60">
                            {busy ? 'Starting…' : picked.length > 1 ? `Start group with ${picked.length} people` : `Message ${picked[0].name}`}
                        </button>
                    </div>
                )}
                {error && <p className="mt-2 text-sm text-ink">{error}</p>}
            </div>
            <ul className="scroll-area flex-1 overflow-y-auto">
                {people.map((p) => {
                    const on = picked.some((x) => x.id === p.id);
                    return (
                        <li key={p.id}>
                            <button disabled={busy} onClick={() => (platform ? toggle(p) : start([p]))}
                                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-mist ${on ? 'bg-mist' : ''}`}>
                                <Avatar name={p.name} size={38} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-semibold text-grove">{p.name}</p>
                                    <p className="truncate text-xs text-muted">{p.where}</p>
                                </div>
                                {platform && <span className={`size-5 rounded-full border-2 ${on ? 'border-leaf bg-leaf' : 'border-line'}`} aria-hidden />}
                            </button>
                        </li>
                    );
                })}
                {!people.length && <li className="p-6 text-center text-sm text-muted">{q ? 'No one found.' : 'No one to message yet.'}</li>}
            </ul>
        </div>
    );
}

function Conversation({ id, onActivity }: { id: number; onActivity: () => void }) {
    const [msgs, setMsgs] = useState<Msg[] | null>(null);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const lastId = useRef(0);
    const bottom = useRef<HTMLDivElement>(null);

    const fetchNew = useCallback(async () => {
        try {
            const r = await api<{ messages: Msg[] }>(`/platform-chat/${id}/messages?after=${lastId.current}`);
            if (r.messages.length) {
                lastId.current = r.messages[r.messages.length - 1].id;
                setMsgs((m) => [...(m ?? []), ...r.messages.filter((x) => !(m ?? []).some((y) => y.id === x.id))]);
                onActivity();
            } else setMsgs((m) => m ?? []);
        } catch (e) { setError((e as Error).message); }
    }, [id, onActivity]);

    useEffect(() => { fetchNew(); }, [fetchNew]);
    useEffect(() => listenUser('platform.message', (d: { thread_id?: number }) => { if (d?.thread_id === id) fetchNew(); }), [id, fetchNew]);
    useEffect(() => { const t = window.setInterval(fetchNew, 15_000); return () => window.clearInterval(t); }, [fetchNew]);
    useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

    const send = async () => {
        const body = text.trim();
        if (!body || sending) return;
        setSending(true); setError(null);
        try {
            const m = await api<Msg>(`/platform-chat/${id}/messages`, { body: { body } });
            lastId.current = Math.max(lastId.current, m.id);
            setMsgs((s) => [...(s ?? []), m]);
            setText('');
            onActivity();
        } catch (e) { setError((e as Error).message); }
        setSending(false);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-mist/60">
            <div className="scroll-area flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
                {msgs === null && <div className="flex justify-center py-10 text-muted"><Loader2 className="animate-spin" /></div>}
                {msgs?.length === 0 && <p className="py-10 text-center text-sm text-muted">Say hello 👋</p>}
                {msgs?.map((m, i) => (
                    <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.mine ? 'rounded-br-md bg-mint text-ink' : 'rounded-bl-md bg-white text-ink'}`}>
                            {!m.mine && msgs[i - 1]?.from !== m.from && <p className="mb-0.5 text-xs font-semibold text-leaf">{m.from}</p>}
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className="mt-0.5 text-right text-[11px] text-muted">{time(m.at)}</p>
                        </div>
                    </div>
                ))}
                <div ref={bottom} />
            </div>
            {error && <p className="bg-amber/15 px-3 py-1.5 text-sm text-ink">{error}</p>}
            <div className="flex items-end gap-2 border-t border-line bg-white p-2">
                <textarea
                    value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Message"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-line px-3 py-2 text-sm outline-none focus:border-leaf"
                />
                <button onClick={send} disabled={!text.trim() || sending} aria-label="Send"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grove text-white disabled:opacity-50">
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
            </div>
        </div>
    );
}
