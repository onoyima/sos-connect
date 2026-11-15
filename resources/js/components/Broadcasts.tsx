import { ExternalLink, Megaphone, PartyPopper, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { listenInstitution } from '@/lib/live';

export type BroadcastItem = { id: number; kind: 'popup' | 'marquee'; style: 'info' | 'urgent' | 'celebration'; title: string | null; body: string; link_url: string | null; link_label: string | null; version: string };

const SEEN = 'sos.popupsSeen';
const HIDDEN = 'sos.marqueeHidden';
const read = (k: string): string[] => { try { return JSON.parse(sessionStorage.getItem(k) ?? '[]'); } catch { return []; } };
const write = (k: string, v: string[]) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const key = (b: BroadcastItem) => `${b.id}:${b.version}`;

const tone = {
    info: 'bg-grove text-white',
    urgent: 'bg-sos text-white',
    celebration: 'bg-gradient-to-r from-[#7a3fd1] via-[#d6336c] to-[#f08c00] text-white',
} as const;

/**
 * Messages from the institution. The marquee slides across the top of every page and never blocks anything
 * (hover pauses it; it can be hidden until the site is opened again). Pop-ups appear when the site is opened,
 * every time it is opened, until the sender pauses them; a pop-up never interrupts a page that is already open.
 */
export function Broadcasts() {
    const [marquees, setMarquees] = useState<BroadcastItem[]>([]);
    const [popups, setPopups] = useState<BroadcastItem[]>([]);
    const [hidden, setHidden] = useState(() => read(HIDDEN));

    const load = useCallback((withPopups: boolean) => {
        api<{ popups: BroadcastItem[]; marquees: BroadcastItem[] }>('/broadcasts/active').then((r) => {
            setMarquees(r.marquees);
            const seen = read(SEEN);
            const live = new Set(r.popups.map(key));
            // Paused or deleted pop-ups disappear at once; new ones wait until the next time the site is opened.
            setPopups((cur) => (withPopups ? r.popups.filter((p) => !seen.includes(key(p))) : cur.filter((p) => live.has(key(p)))));
        }).catch(() => {});
    }, []);

    useEffect(() => {
        load(true);
        return listenInstitution('broadcast.changed', () => load(false));
    }, [load]);

    const visible = marquees.filter((m) => !hidden.includes(key(m)));
    const popup = popups[0];
    const closePopup = () => {
        if (!popup) return;
        write(SEEN, [...read(SEEN), key(popup)]);
        setPopups((l) => l.slice(1));
    };

    return (
        <>
            {visible.length > 0 && (
                <div className={`group relative flex h-8 shrink-0 items-center overflow-hidden text-[13.5px] ${tone[visible[0].style]}`} role="marquee" aria-label="Messages from your institution">
                    <span className="z-10 flex h-full shrink-0 items-center bg-inherit pr-2 pl-3"><Megaphone size={15} /></span>
                    <div className="relative min-w-0 flex-1 overflow-hidden">
                        <div className="marquee-track flex w-max gap-12 whitespace-nowrap group-hover:[animation-play-state:paused]" style={{ animationDuration: `${Math.max(18, visible.reduce((n, m) => n + m.body.length, 0) / 6)}s` }}>
                            {[0, 1].map((copy) => (
                                <span key={copy} className="flex gap-12" aria-hidden={copy === 1}>
                                    {visible.map((m) => (
                                        <span key={m.id} className="font-medium">
                                            {m.title && <strong className="mr-1.5">{m.title}:</strong>}{m.body}
                                            {m.link_url && <a href={m.link_url} target={m.link_url.startsWith('/') ? undefined : '_blank'} rel="noreferrer" className="ml-2 underline">{m.link_label || 'Open'}</a>}
                                        </span>
                                    ))}
                                </span>
                            ))}
                        </div>
                    </div>
                    <button className="z-10 flex h-full shrink-0 items-center bg-inherit px-2.5 opacity-80 hover:opacity-100" aria-label="Hide these messages"
                        onClick={() => { const h = [...hidden, ...visible.map(key)]; setHidden(h); write(HIDDEN, h); }}><X size={15} /></button>
                </div>
            )}
            {popup && <Popup item={popup} more={popups.length - 1} onClose={closePopup} />}
        </>
    );
}

function Popup({ item, more, onClose }: { item: BroadcastItem; more: number; onClose: () => void }) {
    useEffect(() => {
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);
    const Icon = item.style === 'urgent' ? TriangleAlert : item.style === 'celebration' ? PartyPopper : Megaphone;
    return (
        <div className="fade-in fixed inset-0 z-[70] flex items-center justify-center bg-grove/50 p-4">
            <div role="alertdialog" aria-modal aria-labelledby="bc-title" className="sheet-in w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-xl">
                <div className={`flex items-center gap-3 px-5 py-4 ${tone[item.style]}`}>
                    <Icon size={22} className="shrink-0" />
                    <h2 id="bc-title" className="min-w-0 flex-1 text-lg font-bold break-words text-white">{item.title || 'Message from your institution'}</h2>
                </div>
                <div className="scroll-area max-h-[60dvh] px-5 py-4 text-[15px] whitespace-pre-line text-ink">{item.body}</div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
                    {more > 0 && <span className="mr-auto text-xs text-muted">{more} more</span>}
                    {item.link_url && <a className="btn-outline" href={item.link_url} target={item.link_url.startsWith('/') ? undefined : '_blank'} rel="noreferrer" onClick={onClose}>{item.link_label || 'Open'}<ExternalLink size={14} /></a>}
                    <button autoFocus className="btn-primary" onClick={onClose}>OK</button>
                </div>
            </div>
        </div>
    );
}
