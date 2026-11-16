import { compressImage } from '@/lib/compress';
import { Head, router, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleDot, Eye, EyeOff, Heart, Music, ImagePlus, MessageCircle, Palette, Pause, Play, Send, ThumbsUp, Trash2, UserPlus, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Avatar, EmptyState, PageBody, PageHeader, when } from '@/components/ui';
import { onChange } from '@/lib/live';
import { api, fileUrl } from '@/lib/api';
import type { SharedProps } from '@/types';

type Person = { id: number; name: string; title?: string | null };
type Reactions = { like: number; love: number };
type Status = {
    id: number; user: Person; body: string | null; media_path: string | null; media_type?: 'image' | 'gif' | 'video' | 'audio' | null; background: string | null; audience: string | null;
    mentions: Person[]; comment_count: number; reactions: Reactions; my_reaction: 'like' | 'love' | null; view_count: number | null;
    expires_at: string; created_at: string; viewed: boolean;
};
type Comment = { id: number; user: Person; body: string; reply_to: { id: number; name: string | null; body: string } | null; created_at: string; can_delete: boolean };
type Viewer = { id: number; name: string; viewed_at: string; reaction: 'like' | 'love' | null };

const AUDIENCE: Record<string, string> = {
    contacts: 'People I have chatted with', department: 'My department', faculty: 'My faculty', groups: 'Groups I choose',
    selected: 'People I choose', institution: 'Everyone in my institution',
};
type MediaKind = 'image' | 'gif' | 'video' | 'audio';
const kindOf = (f: File): MediaKind | null => f.type === 'image/gif' ? 'gif' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : null;
const COLOURS = ['#0e3b2e', '#1e7b57', '#173a5c', '#5a3d0c', '#7a2433', '#3f2a5c', '#134540'];
const SHOW_MS = 7000;

export default function StatusPage() {
    const { auth } = usePage<SharedProps>().props;
    const me = auth!.user;
    const canPost = auth!.permissions.includes('status.post');
    const [items, setItems] = useState<Status[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [viewer, setViewer] = useState<{ userId: number; index: number } | null>(null);

    const load = useCallback(() => api<{ statuses: Status[] }>('/status').then((r) => { setItems(r.statuses); setLoaded(true); }), []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => onChange('status', () => { load(); }), [load]);

    // One entry per person, newest first; people with unseen updates first.
    const groups = useMemo(() => {
        const map = new Map<number, Status[]>();
        for (const s of [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
            map.set(s.user.id, [...(map.get(s.user.id) ?? []), s]);
        }
        return [...map.entries()].map(([userId, list]) => ({ userId, user: list[0].user, list, unseen: list.some((s) => !s.viewed), latest: list[list.length - 1].created_at }))
            .sort((a, b) => b.latest.localeCompare(a.latest));
    }, [items]);
    const mine = groups.find((g) => g.userId === me.id);
    const others = groups.filter((g) => g.userId !== me.id);
    const order = [...(mine ? [mine] : []), ...others.filter((g) => g.unseen), ...others.filter((g) => !g.unseen)];

    const openGroup = (userId: number) => {
        const g = groups.find((x) => x.userId === userId);
        if (!g) return;
        const firstUnseen = g.list.findIndex((s) => !s.viewed && s.user.id !== me.id);
        setViewer({ userId, index: firstUnseen >= 0 ? firstUnseen : 0 });
    };
    const update = (id: number, patch: Partial<Status>) => setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

    return (
        <AppLayout title="Status">
            <Head title="Status" />
            <PageHeader title="Status" description="Short updates that disappear after 24 hours. Like, love, comment or reply to the ones you see." />
            <PageBody narrow>
                {canPost ? <Composer onPosted={load} meName={me.name} /> : (
                    <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-muted">Posting status updates isn't turned on for your account. Your institution's admins can turn it on under Admin &gt; Roles.</p>
                )}

                {mine && <Section title="Your updates" groups={[mine]} onOpen={openGroup} meId={me.id} />}
                {others.some((g) => g.unseen) && <Section title="Recent" groups={others.filter((g) => g.unseen)} onOpen={openGroup} meId={me.id} />}
                {others.some((g) => !g.unseen) && <Section title="Already seen" groups={others.filter((g) => !g.unseen)} onOpen={openGroup} meId={me.id} />}
                {loaded && groups.length === 0 && (
                    <EmptyState icon={<CircleDot size={26} />} title="No updates yet">Updates from people you chat with, your department, and anyone who tags you show up here.</EmptyState>
                )}
            </PageBody>

            {viewer && (
                <Viewer
                    group={groups.find((g) => g.userId === viewer.userId)!}
                    index={viewer.index}
                    meId={me.id}
                    onIndex={(index) => setViewer({ ...viewer, index })}
                    onNextPerson={() => {
                        const i = order.findIndex((g) => g.userId === viewer.userId);
                        const next = order[i + 1];
                        if (next) setViewer({ userId: next.userId, index: Math.max(0, next.list.findIndex((s) => !s.viewed)) });
                        else setViewer(null);
                    }}
                    onPrevPerson={() => {
                        const i = order.findIndex((g) => g.userId === viewer.userId);
                        const prev = order[i - 1];
                        if (prev) setViewer({ userId: prev.userId, index: prev.list.length - 1 });
                    }}
                    onClose={() => setViewer(null)}
                    onUpdate={update}
                    onDeleted={(id) => { setItems((p) => p.filter((s) => s.id !== id)); setViewer(null); }}
                />
            )}
        </AppLayout>
    );
}

function Section({ title, groups, onOpen, meId }: { title: string; groups: { userId: number; user: Person; list: Status[]; unseen: boolean; latest: string }[]; onOpen: (id: number) => void; meId: number }) {
    return (
        <section className="mt-6">
            <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{title}</h2>
            <div className="overflow-hidden rounded-2xl bg-white">
                {groups.map((g) => {
                    const last = g.list[g.list.length - 1];
                    const mine = g.userId === meId;
                    return (
                        <button key={g.userId} onClick={() => onOpen(g.userId)} className="flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-mist">
                            <Ring count={g.list.length} seen={!g.unseen || mine}><StatusThumb s={last} size={44} /></Ring>
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-semibold">{mine ? 'My status' : g.user.name}</div>
                                <div className="truncate text-sm text-muted">
                                    {when(last.created_at)}{g.list.length > 1 ? ` · ${g.list.length} updates` : ''}
                                    {mine && last.view_count !== null ? ` · ${last.view_count} ${last.view_count === 1 ? 'view' : 'views'}` : ''}
                                </div>
                            </div>
                            <ChevronRight size={18} className="shrink-0 text-muted" />
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

/** A round preview of the newest update: the photo, GIF or first video frame, or the colour and text of a text update. */
function StatusThumb({ s, size }: { s: Status; size: number }) {
    const kind = s.media_type ?? (s.media_path ? 'image' : null);
    const box = 'flex shrink-0 items-center justify-center overflow-hidden rounded-full';
    if (s.media_path && (kind === 'image' || kind === 'gif')) {
        return <img src={fileUrl(s.media_path)} alt="" loading="lazy" className={`${box} object-cover`} style={{ width: size, height: size }} />;
    }
    if (s.media_path && kind === 'video') {
        // #t=0.1 makes browsers show the first frame without playing it.
        return <video src={`${fileUrl(s.media_path)}#t=0.1`} muted playsInline preload="metadata" className={`${box} bg-ink object-cover`} style={{ width: size, height: size }} />;
    }
    return (
        <span className={`${box} text-white`} style={{ width: size, height: size, background: s.background ?? COLOURS[0] }}>
            {kind === 'audio' ? <Music size={size * 0.42} />
                : <span className="line-clamp-2 px-1 text-center font-bold leading-tight break-words" style={{ fontSize: Math.max(8, size / 6) }}>{(s.body ?? '').slice(0, 24)}</span>}
        </span>
    );
}

/** The ring round an avatar, split into one segment per update. */
function Ring({ count, seen, children }: { count: number; seen: boolean; children: React.ReactNode }) {
    const gap = count > 1 ? 6 : 0;
    const seg = 360 / count;
    const stops = Array.from({ length: count }, (_, i) => `${seen ? '#c9d5cf' : '#1e7b57'} ${i * seg + gap / 2}deg ${(i + 1) * seg - gap / 2}deg, transparent ${(i + 1) * seg - gap / 2}deg ${(i + 1) * seg + gap / 2}deg`).join(', ');
    return (
        <span className="shrink-0 rounded-full p-[3px]" style={{ background: `conic-gradient(${stops})` }}>
            <span className="block rounded-full bg-white p-[2px]">{children}</span>
        </span>
    );
}

// ---- Posting ----------------------------------------------------------------------------------------

function Composer({ onPosted, meName }: { onPosted: () => void; meName: string }) {
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState('contacts');
    const [colour, setColour] = useState(0);
    const [photo, setPhoto] = useState<{ file: File; url: string; kind: MediaKind } | null>(null);
    const [tags, setTags] = useState<Person[]>([]);
    const [groupIds, setGroupIds] = useState<number[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [hidden, setHidden] = useState<Person[]>([]);
    const [hiding, setHiding] = useState(false);
    const [tagging, setTagging] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

    const pick = (f: File | undefined) => {
        if (!f) return;
        const kind = kindOf(f);
        if (!kind) { setError('Choose a photo, GIF, video or audio file.'); return; }
        if (f.size > 50 * 1024 * 1024) { setError('That file is too big (50 MB at most).'); return; }
        setError(null);
        setPhoto({ file: f, url: URL.createObjectURL(f), kind });
    };

    const share = async () => {
        setBusy(true);
        setError(null);
        try {
            let media_path: string | undefined;
            if (photo) {
                const form = new FormData();
                form.append('file', await compressImage(photo.file)); // photos are made smaller first, like WhatsApp
                media_path = (await api<{ path: string }>('/uploads', { form })).path;
            }
            await api('/status', { body: {
                body: body.trim() || null, media_path, audience, background: photo && photo.kind !== 'audio' ? null : COLOURS[colour], mentions: tags.map((t) => t.id),
                group_ids: audience === 'groups' ? groupIds : undefined, people: audience === 'selected' ? people.map((p) => p.id) : undefined,
                hidden: hidden.map((p) => p.id),
            } });
            setBody(''); setPhoto(null); setTags([]); setTagging(false); setHidden([]); setHiding(false);
            onPosted();
        } catch (e) {
            setError((e as Error).message);
        } finally { setBusy(false); }
    };

    const ready = (!!body.trim() || !!photo) && (audience !== 'groups' || groupIds.length > 0) && (audience !== 'selected' || people.length > 0);
    return (
        <div className="rounded-2xl bg-white p-4">
            <div className="flex gap-3">
                <Avatar name={meName} size={44} />
                <div className="min-w-0 flex-1">
                    <textarea className="input resize-none" rows={2} maxLength={700} placeholder={photo ? 'Add a caption (optional)' : "What's happening?"} value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
            </div>

            {/* Preview: exactly how it will look */}
            {(photo || body.trim()) && (
                <div className="mt-3">
                    <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Preview</div>
                    <div className="relative overflow-hidden rounded-2xl bg-black">
                        {photo ? (
                            <>
                                {photo.kind === 'video' ? <video src={photo.url} controls playsInline className="mx-auto max-h-80 w-full bg-black" />
                                    : photo.kind === 'audio' ? <div className="flex min-h-32 flex-col items-center justify-center gap-3 p-6" style={{ background: COLOURS[colour] }}><audio src={photo.url} controls className="w-full max-w-sm" /></div>
                                        : <img src={photo.url} alt="Your photo" className="mx-auto max-h-80 w-full object-contain" />}
                                {body.trim() && <p className="bg-black/60 px-4 py-2 text-center text-[15px] break-words whitespace-pre-wrap text-white">{body}</p>}
                                <button className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80" onClick={() => setPhoto(null)} aria-label="Remove photo"><X size={18} /></button>
                            </>
                        ) : (
                            <div className="flex min-h-40 items-center justify-center p-6 text-center text-xl leading-snug font-semibold break-words whitespace-pre-wrap text-white" style={{ background: COLOURS[colour] }}>{body}</div>
                        )}
                    </div>
                    {tags.length > 0 && <p className="mt-1.5 text-sm text-muted">With {tags.map((t) => t.name).join(', ')}</p>}
                </div>
            )}

            {tagging && <TagPicker chosen={tags} onChange={setTags} />}
            {error && <p role="alert" className="mt-2 text-sm text-sos">{error}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="btn-ghost cursor-pointer"><ImagePlus size={18} />Photo, GIF or video
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <label className="btn-ghost cursor-pointer"><Music size={18} />Audio
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {(!photo || photo.kind === 'audio') && (
                    <button type="button" className="btn-ghost" onClick={() => setColour((c) => (c + 1) % COLOURS.length)} aria-label="Change background colour">
                        <Palette size={18} /><span className="size-4 rounded-full ring-1 ring-line" style={{ background: COLOURS[colour] }} />
                    </button>
                )}
                <button type="button" className={`btn-ghost ${tagging ? 'bg-mist' : ''}`} onClick={() => setTagging(!tagging)}><UserPlus size={18} />Tag{tags.length ? ` (${tags.length})` : ''}</button>
                <select className="input w-auto max-w-full py-1.5 text-sm" value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Who can see this">
                    {Object.entries(AUDIENCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button type="button" className={`btn-ghost ${hiding ? 'bg-mist' : ''}`} onClick={() => setHiding(!hiding)}><EyeOff size={18} />Hide from{hidden.length ? ` (${hidden.length})` : ''}</button>
                <button className="btn-primary ml-auto" disabled={!ready || busy} onClick={share}>{busy ? 'Sharing…' : 'Share'}</button>
            </div>
            {audience === 'groups' && <GroupChooser chosen={groupIds} onChange={setGroupIds} />}
            {audience === 'selected' && <div><p className="mt-3 text-sm font-medium">Share only with</p><TagPicker chosen={people} onChange={setPeople} placeholder="Search for people to share with" /></div>}
            {hiding && <div><p className="mt-3 text-sm font-medium">Don't show this update to</p><TagPicker chosen={hidden} onChange={setHidden} placeholder="Search for people to hide it from" /></div>}
            {tags.length > 0 && <p className="mt-2 text-xs text-muted">People you tag can see this update and are told about it, whoever else it's shared with.</p>}
        </div>
    );
}

/** "Groups I choose": the groups I'm in. */
function GroupChooser({ chosen, onChange }: { chosen: number[]; onChange: (ids: number[]) => void }) {
    const [groups, setGroups] = useState<{ id: number; name: string; member_count: number }[]>([]);
    useEffect(() => { api<{ conversations: { id: number; name: string; type: string; member_count: number }[] }>('/conversations').then((r) => setGroups(r.conversations.filter((c) => c.type !== 'direct'))).catch(() => {}); }, []);
    return (
        <div className="mt-3 rounded-xl border border-line p-3">
            <p className="mb-2 text-sm font-medium">Share with members of</p>
            <div className="scroll-area max-h-52 space-y-1">
                {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-mist">
                        <input type="checkbox" checked={chosen.includes(g.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, g.id] : chosen.filter((x) => x !== g.id))} />
                        <span className="min-w-0 flex-1 truncate">{g.name}</span><span className="text-xs text-muted">{g.member_count}</span>
                    </label>
                ))}
                {groups.length === 0 && <p className="text-sm text-muted">You're not in any groups yet.</p>}
            </div>
        </div>
    );
}

function TagPicker({ chosen, onChange, placeholder = 'Search for someone to tag' }: { chosen: Person[]; onChange: (p: Person[]) => void; placeholder?: string }) {
    const [q, setQ] = useState('');
    const [found, setFound] = useState<Person[]>([]);
    useEffect(() => {
        if (q.trim().length < 2) { setFound([]); return; }
        const t = window.setTimeout(() => api<{ people: Person[] }>(`/directory?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.people)).catch(() => setFound([])), 250);
        return () => window.clearTimeout(t);
    }, [q]);
    return (
        <div className="mt-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap gap-1.5">
                {chosen.map((p) => (
                    <span key={p.id} className="pill bg-mint text-grove">{p.name}
                        <button onClick={() => onChange(chosen.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}><X size={13} /></button>
                    </span>
                ))}
            </div>
            <input className="input mt-2" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {found.length > 0 && (
                <ul className="scroll-area mt-1 max-h-52">
                    {found.filter((p) => !chosen.some((c) => c.id === p.id)).map((p) => (
                        <li key={p.id}>
                            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-mist" onClick={() => { onChange([...chosen, p].slice(0, 20)); setQ(''); }}>
                                <Avatar name={p.name} size={30} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span>{p.title && <span className="block truncate text-xs text-muted">{p.title}</span>}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ---- Viewing ----------------------------------------------------------------------------------------

type ViewerProps = {
    group: { userId: number; user: Person; list: Status[] }; index: number; meId: number;
    onIndex: (i: number) => void; onNextPerson: () => void; onPrevPerson: () => void; onClose: () => void;
    onUpdate: (id: number, p: Partial<Status>) => void; onDeleted: (id: number) => void;
};

function Viewer({ group, index, meId, onIndex, onNextPerson, onPrevPerson, onClose, onUpdate, onDeleted }: ViewerProps) {
    const interact = usePage<SharedProps>().props.modules?.status_interactions !== false;
    const s = group.list[Math.min(index, group.list.length - 1)];
    const mine = s.user.id === meId;
    const [paused, setPaused] = useState(false);
    const [panel, setPanel] = useState<null | 'comments' | 'viewers'>(null);
    const [elapsed, setElapsed] = useState(0);
    const [reply, setReply] = useState('');
    const [toast, setToast] = useState<{ text: string; chat?: number } | null>(null);
    const typing = reply.length > 0;
    const playable = s.media_path && (s.media_type === 'video' || s.media_type === 'audio');
    const media = useRef<HTMLMediaElement | null>(null);
    const [mediaMs, setMediaMs] = useState(SHOW_MS);
    const hold = paused || panel !== null || typing || !!playable; // videos and audio move on when they finish
    const total = playable ? mediaMs : SHOW_MS;
    useEffect(() => { const m = media.current; if (!m) return; if (paused || panel || typing) m.pause(); else m.play().catch(() => {}); }, [paused, panel, typing, s.id]);

    const next = () => (index < group.list.length - 1 ? onIndex(index + 1) : onNextPerson());
    const prev = () => (index > 0 ? onIndex(index - 1) : onPrevPerson());

    // Mark as seen once shown.
    useEffect(() => {
        setElapsed(0);
        setPanel(null);
        setReply('');
        if (!mine && !s.viewed) {
            api(`/status/${s.id}/view`, { method: 'POST' }).catch(() => {});
            onUpdate(s.id, { viewed: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [s.id]);

    // Moves on by itself unless paused, reading comments or typing a reply.
    useEffect(() => {
        if (hold) return;
        const t = window.setInterval(() => setElapsed((e) => e + 100), 100);
        return () => window.clearInterval(t);
    }, [hold, s.id]);
    useEffect(() => { if (!playable && elapsed >= SHOW_MS) next(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [elapsed]);

    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
            if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });

    const react = async (r: 'like' | 'love') => {
        const want = s.my_reaction === r ? null : r;
        const before = { reactions: s.reactions, my_reaction: s.my_reaction };
        const counts = { ...s.reactions };
        if (s.my_reaction) counts[s.my_reaction] = Math.max(0, counts[s.my_reaction] - 1);
        if (want) counts[want] += 1;
        onUpdate(s.id, { my_reaction: want, reactions: counts });
        try {
            const res = await api<{ reactions: Reactions; my_reaction: Status['my_reaction'] }>(`/status/${s.id}/react`, { body: { reaction: want } });
            onUpdate(s.id, res);
        } catch { onUpdate(s.id, before); }
    };

    const sendReply = async () => {
        const text = reply.trim();
        if (!text) return;
        try {
            const r = await api<{ conversation_id: number }>(`/status/${s.id}/reply`, { body: { body: text } });
            setReply('');
            setToast({ text: `Sent to ${s.user.name}`, chat: r.conversation_id });
        } catch (e) { setToast({ text: (e as Error).message }); }
    };

    const remove = async () => {
        if (!window.confirm('Delete this update? It disappears for everyone.')) return;
        await api(`/status/${s.id}`, { method: 'DELETE' });
        onDeleted(s.id);
    };

    return (
        <div className="fade-in fixed inset-0 z-50 flex bg-black text-white" role="dialog" aria-modal aria-label={`${mine ? 'Your' : `${s.user.name}'s`} status`}>
            <div className="relative mx-auto flex h-full w-full max-w-lg flex-col">
                {/* Progress, one bar per update */}
                <div className="flex gap-1 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
                    {group.list.map((x, i) => (
                        <div key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                            <div className="h-full bg-white" style={{ width: i < index ? '100%' : i > index ? '0%' : `${Math.min(100, (elapsed / total) * 100)}%` }} />
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-3 px-3 py-3">
                    <Avatar name={s.user.name} size={38} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{mine ? 'You' : s.user.name}</div>
                        <div className="truncate text-xs text-white/65">{when(s.created_at)}{mine && s.audience ? ` · ${AUDIENCE[s.audience]}` : ''}</div>
                    </div>
                    <button className="flex size-10 items-center justify-center rounded-full hover:bg-white/10" onClick={() => setPaused(!paused)} aria-label={paused ? 'Play' : 'Pause'}>{paused ? <Play size={20} /> : <Pause size={20} />}</button>
                    {mine && <button className="flex size-10 items-center justify-center rounded-full hover:bg-white/10" onClick={remove} aria-label="Delete this update"><Trash2 size={19} /></button>}
                    <button className="flex size-10 items-center justify-center rounded-full hover:bg-white/10" onClick={onClose} aria-label="Close"><X size={22} /></button>
                </div>

                {/* The update. Left third goes back, the rest goes forward. */}
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                    {s.media_path && s.media_type === 'video' ? (
                        <video key={s.id} ref={(el) => { media.current = el; }} src={fileUrl(s.media_path)} autoPlay playsInline className="relative z-10 max-h-full max-w-full"
                            onLoadedMetadata={(e) => setMediaMs(Math.max(1000, e.currentTarget.duration * 1000))} onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime * 1000)} onEnded={next} />
                    ) : s.media_path && s.media_type === 'audio' ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-5 p-8" style={{ background: s.background ?? COLOURS[0] }}>
                            <Music size={56} className="opacity-80" />
                            <audio key={s.id} ref={(el) => { media.current = el; }} src={fileUrl(s.media_path)} autoPlay controls className="relative z-10 w-full max-w-sm"
                                onLoadedMetadata={(e) => setMediaMs(Math.max(1000, e.currentTarget.duration * 1000))} onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime * 1000)} onEnded={next} />
                        </div>
                    ) : s.media_path ? (
                        <img src={fileUrl(s.media_path)} alt={s.body ?? 'Photo status'} className="max-h-full max-w-full object-contain" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center p-8 text-center text-2xl leading-snug font-semibold break-words whitespace-pre-wrap" style={{ background: s.background ?? COLOURS[0] }}>{s.body}</div>
                    )}
                    <button className="absolute inset-y-0 left-0 w-1/3" onClick={prev} aria-label="Previous update" />
                    <button className="absolute inset-y-0 right-0 w-2/3" onClick={next} aria-label="Next update" />
                    <button className="absolute top-1/2 left-2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 sm:flex" onClick={prev} aria-label="Previous"><ChevronLeft size={22} /></button>
                    <button className="absolute top-1/2 right-2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 sm:flex" onClick={next} aria-label="Next"><ChevronRight size={22} /></button>
                </div>

                {s.media_path && s.body && <p className="max-h-28 overflow-y-auto px-4 py-2 text-center text-[15px] break-words whitespace-pre-wrap">{s.body}</p>}
                {s.mentions.length > 0 && <p className="px-4 pb-1 text-center text-sm text-white/75">With {s.mentions.map((m) => (m.id === meId ? 'you' : m.name)).join(', ')}</p>}

                {toast && (
                    <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-white/12 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">{toast.text}</span>
                        {toast.chat && <button className="font-semibold text-[#8fd3b4]" onClick={() => router.visit(`/chats/${toast.chat}`)}>Open chat</button>}
                        <button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button>
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 px-3 pt-1 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                    {mine ? (
                        <>
                            <button className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm hover:bg-white/20" onClick={() => setPanel(panel === 'viewers' ? null : 'viewers')}>
                                <Eye size={17} />{s.view_count ?? 0}
                            </button>
                            <span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm"><ThumbsUp size={16} />{s.reactions.like}</span>
                            <span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm"><Heart size={16} />{s.reactions.love}</span>
                            <button className="ml-auto flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm hover:bg-white/20" onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
                                <MessageCircle size={17} />{s.comment_count}
                            </button>
                        </>
                    ) : !interact ? (
                        <span className="text-sm text-white/60">Likes, comments and replies are switched off by your institution.</span>
                    ) : (
                        <>
                            <ReactButton active={s.my_reaction === 'like'} count={s.reactions.like} label="Like" onClick={() => react('like')}><ThumbsUp size={18} fill={s.my_reaction === 'like' ? 'currentColor' : 'none'} /></ReactButton>
                            <ReactButton active={s.my_reaction === 'love'} count={s.reactions.love} label="Love" onClick={() => react('love')} love><Heart size={18} fill={s.my_reaction === 'love' ? 'currentColor' : 'none'} /></ReactButton>
                            <button className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm hover:bg-white/20" onClick={() => setPanel(panel === 'comments' ? null : 'comments')} aria-label="Comments">
                                <MessageCircle size={18} />{s.comment_count}
                            </button>
                            <form className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-white/10 pr-1 pl-3" onSubmit={(e) => { e.preventDefault(); sendReply(); }}>
                                <input className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white placeholder:text-white/55 focus:outline-none" placeholder="Reply privately…" maxLength={4000}
                                    value={reply} onChange={(e) => setReply(e.target.value)} aria-label={`Reply privately to ${s.user.name}`} />
                                <button className="flex size-8 shrink-0 items-center justify-center rounded-full bg-leaf disabled:opacity-40" disabled={!reply.trim()} aria-label="Send reply"><Send size={15} /></button>
                            </form>
                        </>
                    )}
                </div>

                {panel === 'comments' && <Comments status={s} meId={meId} onCount={(n) => onUpdate(s.id, { comment_count: n })} onClose={() => setPanel(null)} />}
                {panel === 'viewers' && <Viewers statusId={s.id} onClose={() => setPanel(null)} />}
            </div>
        </div>
    );
}

function ReactButton({ active, count, label, love = false, onClick, children }: { active: boolean; count: number; label: string; love?: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick} aria-pressed={active} aria-label={`${label}${active ? 'd' : ''} (${count})`}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${active ? (love ? 'bg-[#ff4d6d] text-white' : 'bg-leaf text-white') : 'bg-white/10 hover:bg-white/20'}`}>
            {children}{count > 0 && count}
        </button>
    );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="sheet-in absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-3xl bg-white text-ink shadow-2xl">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <h2 className="text-base font-bold">{title}</h2>
                <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close"><X size={20} /></button>
            </div>
            {children}
        </div>
    );
}

function Comments({ status, meId, onCount, onClose }: { status: Status; meId: number; onCount: (n: number) => void; onClose: () => void }) {
    const [list, setList] = useState<Comment[] | null>(null);
    const [text, setText] = useState('');
    const [replyTo, setReplyTo] = useState<Comment | null>(null);
    const [error, setError] = useState<string | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const load = () => api<{ comments: Comment[] }>(`/status/${status.id}/comments`).then((r) => { setList(r.comments); onCount(r.comments.length); }).catch((e) => setError(e.message));
        load();
        return onChange('status', () => { load(); }); // new comments from others appear at once
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.id]);

    const post = async () => {
        if (!text.trim()) return;
        try {
            const r = await api<{ comment: Comment }>(`/status/${status.id}/comments`, { body: { body: text.trim(), reply_to_id: replyTo?.id ?? null } });
            const next = [...(list ?? []), r.comment];
            setList(next);
            onCount(next.length);
            setText('');
            setReplyTo(null);
            setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 30);
        } catch (e) { setError((e as Error).message); }
    };
    const remove = async (c: Comment) => {
        await api(`/status/${status.id}/comments/${c.id}`, { method: 'DELETE' });
        const next = (list ?? []).filter((x) => x.id !== c.id);
        setList(next);
        onCount(next.length);
    };

    return (
        <Sheet title={`Comments${list ? ` (${list.length})` : ''}`} onClose={onClose}>
            <div className="scroll-area min-h-24 flex-1 px-4">
                {list === null && !error && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
                {list?.length === 0 && <p className="py-6 text-center text-sm text-muted">No comments yet. Be the first.</p>}
                {list?.map((c) => (
                    <div key={c.id} className="flex gap-2.5 py-2">
                        <Avatar name={c.user.name} size={32} />
                        <div className="min-w-0 flex-1">
                            <div className="rounded-2xl bg-mist px-3 py-2">
                                <div className="text-sm font-semibold">{c.user.id === meId ? 'You' : c.user.name}</div>
                                {c.reply_to && <div className="mb-0.5 truncate border-l-2 border-leaf pl-2 text-xs text-muted">{c.reply_to.name}: {c.reply_to.body}</div>}
                                <p className="text-[15px] break-words whitespace-pre-wrap">{c.body}</p>
                            </div>
                            <div className="mt-0.5 flex gap-3 px-2 text-xs text-muted">
                                <span>{when(c.created_at)}</span>
                                <button className="font-semibold hover:text-ink" onClick={() => { setReplyTo(c); input.current?.focus(); }}>Reply</button>
                                {c.can_delete && <button className="font-semibold hover:text-sos" onClick={() => remove(c)}>Delete</button>}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={end} />
            </div>
            {error && <p className="px-4 text-sm text-sos">{error}</p>}
            {replyTo && (
                <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-xs text-muted">
                    <span className="min-w-0 flex-1 truncate">Replying to <strong className="text-ink">{replyTo.user.name}</strong></span>
                    <button onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={15} /></button>
                </div>
            )}
            <form className="flex items-center gap-2 border-t border-line px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]" onSubmit={(e) => { e.preventDefault(); post(); }}>
                <input ref={input} className="input rounded-full" placeholder={replyTo ? `Reply to ${replyTo.user.name}` : 'Add a comment'} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                <button className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf text-white disabled:opacity-40" disabled={!text.trim()} aria-label="Post comment"><Send size={17} /></button>
            </form>
        </Sheet>
    );
}

function Viewers({ statusId, onClose }: { statusId: number; onClose: () => void }) {
    const [list, setList] = useState<Viewer[] | null>(null);
    useEffect(() => { api<{ viewers: Viewer[] }>(`/status/${statusId}/viewers`).then((r) => setList(r.viewers)); }, [statusId]);
    return (
        <Sheet title={`Viewed by${list ? ` ${list.length}` : ''}`} onClose={onClose}>
            <div className="scroll-area px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                {list === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
                {list?.length === 0 && <p className="py-6 text-center text-sm text-muted">Nobody has viewed it yet.</p>}
                {list?.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 py-2">
                        <Avatar name={v.name} size={36} />
                        <div className="min-w-0 flex-1"><div className="truncate font-medium">{v.name}</div><div className="text-xs text-muted">{when(v.viewed_at)}</div></div>
                        {v.reaction === 'love' && <Heart size={18} className="text-[#ff4d6d]" fill="currentColor" aria-label="Loved it" />}
                        {v.reaction === 'like' && <ThumbsUp size={18} className="text-leaf" fill="currentColor" aria-label="Liked it" />}
                    </div>
                ))}
            </div>
        </Sheet>
    );
}
