import { LogOut, Search, ShieldCheck, ShieldOff, UserMinus, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Avatar, Modal, memberLabel } from './ui';

type Info = {
    id: number; type: string; name: string | null; description: string | null; posting: string; community: string | null; member_count: number;
    my_role: string; can: { members: boolean; admins: boolean; settings: boolean; leave: boolean };
    admin_permission_labels: Record<string, string>;
};
type Member = { id: number; name: string; title?: string | null; member_type?: string; department?: string | null; role: string; admin_permissions: string[]; managed: boolean };
type Found = { id: number; name: string; title?: string | null; department?: string | null; reach?: string };

/**
 * Group info inside a chat: who's in it, and (for group admins with the right powers) adding and removing people
 * and making someone a group admin or taking it away. Same rules as the phone app and Admin > Groups.
 */
export function GroupInfo({ conversationId, meId, onClose, onLeft }: { conversationId: number; meId: number; onClose: () => void; onLeft: () => void }) {
    const [info, setInfo] = useState<Info | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [q, setQ] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [powersFor, setPowersFor] = useState<Member | null>(null);

    const load = useCallback(async (page = 1) => {
        const r = await api<{ members: Member[]; next_page: number | null }>(`/conversations/${conversationId}/members?page=${page}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
        setMembers((m) => (page === 1 ? r.members : [...m, ...r.members]));
        setNext(r.next_page);
    }, [conversationId, q]);
    useEffect(() => { api<{ conversation: Info }>(`/conversations/${conversationId}`).then((r) => setInfo(r.conversation)).catch((e) => setError(e.message)); }, [conversationId]);
    useEffect(() => { const t = setTimeout(() => load(1).catch((e) => setError(e.message)), 250); return () => clearTimeout(t); }, [load]);

    const act = async (fn: () => Promise<unknown>) => {
        setError(null);
        try { await fn(); await load(1); } catch (e) { setError((e as Error).message); }
    };
    const setRole = (m: Member, role: 'admin' | 'member', powers?: string[]) =>
        act(() => api(`/conversations/${conversationId}/members/${m.id}`, { method: 'PATCH', body: { role, admin_permissions: powers ?? null } }));
    const remove = (m: Member) => window.confirm(`Remove ${m.name} from this group?`) && act(() => api(`/conversations/${conversationId}/members/${m.id}`, { method: 'DELETE' }));
    const leave = async () => {
        if (!window.confirm('Leave this group?')) return;
        try { await api(`/conversations/${conversationId}/members/${meId}`, { method: 'DELETE' }); onLeft(); } catch (e) { setError((e as Error).message); }
    };

    return (
        <aside className="slide-in-right absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-line bg-white shadow-xl" aria-label="Group info">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <button className="icon-btn" onClick={onClose} aria-label="Close group info"><X size={20} /></button>
                <h2 className="text-base font-bold">Group info</h2>
            </div>
            <div className="scroll-area min-h-0 flex-1">
                {info && (
                    <div className="flex flex-col items-center px-4 py-5 text-center">
                        <Avatar name={info.name} group size={84} />
                        <div className="mt-3 text-lg font-bold break-words text-grove">{info.name}</div>
                        <div className="text-sm text-muted">Group · {info.member_count} members{info.community ? ` · in ${info.community}` : ''}</div>
                        {info.description && <p className="mt-2 text-sm break-words">{info.description}</p>}
                        {info.posting === 'admins' && <p className="mt-2 rounded-full bg-mist px-3 py-1 text-xs text-muted">Only admins can send messages</p>}
                    </div>
                )}
                <div className="flex items-center gap-2 px-3 pb-2">
                    <div className="relative flex-1">
                        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                        <input className="input rounded-full border-transparent bg-mist py-2 pl-9 text-sm" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    {info?.can.members && <button className="btn-outline shrink-0 px-3 py-2 text-sm" onClick={() => setAdding(true)}><UserPlus size={16} />Add</button>}
                </div>
                {error && <p role="alert" className="mx-3 mb-2 rounded-lg bg-sos/10 px-3 py-2 text-sm text-sos">{error}</p>}
                <ul>
                    {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-3 px-3 py-2 hover:bg-mist/60">
                            <Avatar name={m.name} size={38} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="truncate text-sm font-semibold">{m.id === meId ? 'You' : m.name}</span>
                                    {m.role === 'admin' && <span className="pill shrink-0 bg-mint text-[11px] text-grove">Group admin</span>}
                                </div>
                                <div className="truncate text-xs text-muted">{[m.title || memberLabel(m.member_type), m.department].filter(Boolean).join(', ')}</div>
                            </div>
                            {info?.can.admins && m.id !== meId && (
                                m.role === 'admin'
                                    ? <>
                                        <button className="icon-btn size-8" title="Change powers" aria-label={`Change ${m.name}'s admin powers`} onClick={() => setPowersFor(m)}><ShieldCheck size={17} /></button>
                                        <button className="icon-btn size-8 text-sos" title="Remove as group admin" aria-label={`Remove ${m.name} as group admin`} onClick={() => setRole(m, 'member')}><ShieldOff size={17} /></button>
                                    </>
                                    : <button className="btn-ghost shrink-0 px-2.5 py-1 text-xs" onClick={() => setPowersFor(m)}>Make admin</button>
                            )}
                            {info?.can.members && m.id !== meId && !m.managed && (
                                <button className="icon-btn size-8 text-muted hover:text-sos" title="Remove from group" aria-label={`Remove ${m.name}`} onClick={() => remove(m)}><UserMinus size={17} /></button>
                            )}
                        </li>
                    ))}
                </ul>
                {next && <button className="btn-ghost mx-auto my-2 block text-sm" onClick={() => load(next)}>Show more</button>}
                {info?.can.leave && (
                    <button className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left text-sm font-semibold text-sos hover:bg-sos/5" onClick={leave}><LogOut size={18} />Leave group</button>
                )}
                {info && !info.can.leave && info.type !== 'direct' && (
                    <p className="border-t border-line px-4 py-3 text-xs text-muted">You're in this group because of your records at the institution, so you can mute it but not leave it.</p>
                )}
            </div>

            {powersFor && info && (
                <Powers person={powersFor} labels={info.admin_permission_labels} onClose={() => setPowersFor(null)}
                    onSave={(powers) => { setRole(powersFor, 'admin', powers); setPowersFor(null); }} />
            )}
            {adding && <AddMember conversationId={conversationId} onClose={() => setAdding(false)} onAdded={() => load(1)} />}
        </aside>
    );
}

function Powers({ person, labels, onSave, onClose }: { person: Member; labels: Record<string, string>; onSave: (p: string[]) => void; onClose: () => void }) {
    const [powers, setPowers] = useState<string[]>(person.role === 'admin' && person.admin_permissions.length ? person.admin_permissions : Object.keys(labels));
    return (
        <Modal title={`${person.name} as group admin`} onClose={onClose}>
            <p className="mb-3 text-sm text-muted">Choose what they can do in this group.</p>
            <div className="space-y-2">
                {Object.entries(labels).map(([k, l]) => (
                    <label key={k} className="flex items-start gap-3 text-[15px]">
                        <input type="checkbox" className="mt-1 size-4 accent-leaf" checked={powers.includes(k)} onChange={() => setPowers((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
                        {l}
                    </label>
                ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-primary" disabled={powers.length === 0} onClick={() => onSave(powers)}>{person.role === 'admin' ? 'Save powers' : 'Make group admin'}</button>
            </div>
        </Modal>
    );
}

function AddMember({ conversationId, onClose, onAdded }: { conversationId: number; onClose: () => void; onAdded: () => void }) {
    const [q, setQ] = useState('');
    const [found, setFound] = useState<Found[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    useEffect(() => {
        if (q.trim().length < 2) { setFound([]); return; }
        const t = setTimeout(() => api<{ people: Found[] }>(`/directory?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.people)).catch(() => setFound([])), 250);
        return () => clearTimeout(t);
    }, [q]);
    const add = async (p: Found) => {
        setMsg(null);
        try {
            await api(`/conversations/${conversationId}/members`, { body: { user_id: p.id } });
            setMsg(`${p.name} was added.`);
            onAdded();
        } catch (e) { setMsg((e as Error).message); }
    };
    return (
        <Modal title="Add people" onClose={onClose}>
            <input className="input" autoFocus placeholder="Search by name, matric or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
            {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
            <ul className="scroll-area mt-2 max-h-72">
                {found.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                        <Avatar name={p.name} size={36} />
                        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="truncate text-xs text-muted">{[p.title, p.department].filter(Boolean).join(', ')}</div></div>
                        <button className="btn-outline px-3 py-1 text-xs" onClick={() => add(p)}>Add</button>
                    </li>
                ))}
            </ul>
        </Modal>
    );
}
