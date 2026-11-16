import { Loader2, MessageCircle, Phone, UserPlus, UsersRound, Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Avatar, memberLabel } from './ui';

type Person = {
    id: number; name: string; member_type?: string; department?: string | null; level?: number | null; last_seen_at?: string | null;
    phone?: string | null; whatsapp?: string | null; reach?: string; request_id?: number | null; reach_note?: string | null;
    conversation_id?: number | null; shared_groups?: number;
};

/** A chat bubble with a phone inside: the WhatsApp button's icon (drawn here, not the WhatsApp logo). */
export const WhatsAppIcon = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.6 7.6c.3-.3.8-.3 1 .1l.9 1.8c.2.3.1.7-.1.9l-.6.6c.5 1.2 1.6 2.3 2.8 2.8l.6-.6c.3-.3.6-.3.9-.1l1.8.9c.4.2.4.7.1 1-.6.7-1.5 1.1-2.4.9-2.6-.6-4.7-2.7-5.3-5.3-.2-.9.2-1.8.9-2.4Z" fill="currentColor" />
    </svg>
);

const seen = (iso?: string | null) => {
    if (!iso) return 'Not on SOS Connect yet';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    return m < 3 ? 'Online recently' : m < 60 ? `Last seen ${m} min ago` : m < 1440 ? `Last seen ${Math.round(m / 60)} h ago` : `Last seen ${new Date(iso).toLocaleDateString()}`;
};

/** Someone's profile: who they are, their WhatsApp, and ways to reach them here. */
export function ProfileSheet({ userId, onClose, onOpenChat }: { userId: number; onClose: () => void; onOpenChat: (conversationId: number) => void }) {
    const [p, setP] = useState<Person | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { api<{ person: Person }>(`/people/${userId}`).then((r) => setP(r.person)).catch((e) => setError(e.message)); }, [userId]);

    const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } setBusy(false); };
    const message = () => run(async () => {
        if (p?.conversation_id) { onOpenChat(p.conversation_id); return; }
        const r = await api<{ conversation_id: number }>('/conversations/direct', { body: { user_id: userId } });
        onOpenChat(r.conversation_id);
    });
    const request = () => run(async () => {
        const r = await api<{ request?: { id: number }; conversation_id?: number }>('/chat-requests', { body: { user_id: userId } });
        if (r.conversation_id) onOpenChat(r.conversation_id); else setP((x) => (x ? { ...x, reach: 'requested' } : x));
    });
    const call = (type: 'voice' | 'video') => { window.dispatchEvent(new CustomEvent('sos:call', { detail: { id: userId, name: p?.name, type } })); onClose(); };
    const canChat = p && (p.conversation_id || p.reach === 'direct');

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal aria-label="Profile">
            <div className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <div className="relative bg-grove px-5 pt-6 pb-5 text-center text-white">
                    <button onClick={onClose} className="absolute top-3 right-3 rounded-full p-1.5 hover:bg-white/10" aria-label="Close"><X size={20} /></button>
                    {!p && !error && <Loader2 className="mx-auto my-8 animate-spin" />}
                    {p && <>
                        <div className="mx-auto w-fit rounded-full ring-4 ring-white/20"><Avatar name={p.name} size={84} /></div>
                        <h2 className="mt-3 text-xl font-bold break-words text-white">{p.name}</h2>
                        <p className="text-sm text-white/75">{[memberLabel(p.member_type), p.department, p.level ? `${p.level} level` : null].filter(Boolean).join(' · ')}</p>
                        <p className="mt-0.5 text-xs text-white/60">{seen(p.last_seen_at)}</p>
                    </>}
                </div>
                {error && <p role="alert" className="px-5 pt-3 text-sm text-sos">{error}</p>}
                {p && (
                    <div className="space-y-3 p-5">
                        {p.whatsapp ? (
                            <div className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                                <Phone size={18} className="shrink-0 text-muted" />
                                <a href={`tel:+${p.whatsapp}`} className="min-w-0 flex-1 truncate font-semibold text-ink">{p.phone}</a>
                                <a href={`https://wa.me/${p.whatsapp}`} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1fa855] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#178f47]" aria-label={`Open ${p.name} on WhatsApp`}>
                                    <WhatsAppIcon size={18} />WhatsApp
                                </a>
                            </div>
                        ) : <p className="rounded-2xl bg-mist px-3 py-2.5 text-sm text-muted">No phone number shared.</p>}
                        <div className="grid grid-cols-3 gap-2">
                            {canChat ? <Act icon={<MessageCircle size={20} />} label="Message" onClick={message} disabled={busy} />
                                : p.reach === 'request' ? <Act icon={<UserPlus size={20} />} label="Request" onClick={request} disabled={busy} />
                                : <Act icon={<UserPlus size={20} />} label={p.reach === 'requested' ? 'Requested' : p.reach === 'accept' ? 'Asked you' : 'Message'} disabled />}
                            <Act icon={<Phone size={20} />} label="Voice" onClick={() => call('voice')} disabled={!canChat} />
                            <Act icon={<Video size={20} />} label="Video" onClick={() => call('video')} disabled={!canChat} />
                        </div>
                        {p.reach_note && <p className="text-center text-xs text-muted">{p.reach_note}</p>}
                        {!!p.shared_groups && <p className="flex items-center justify-center gap-1.5 text-sm text-muted"><UsersRound size={15} />{p.shared_groups} group{p.shared_groups === 1 ? '' : 's'} in common</p>}
                    </div>
                )}
            </div>
        </div>
    );
}

const Act = ({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1 rounded-2xl bg-mist py-3 text-sm font-semibold text-grove hover:bg-mint disabled:opacity-40">{icon}{label}</button>
);
