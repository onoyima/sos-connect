import { router } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Calm, related tints so a long chat list does not look like a bag of sweets. */
const AVATAR_TINTS = [
    'bg-[#cfe8dc] text-[#0e3b2e]',
    'bg-[#d6e4f0] text-[#173a5c]',
    'bg-[#efe2c8] text-[#5a3d0c]',
    'bg-[#e6dcef] text-[#3f2a5c]',
    'bg-[#f3d9d2] text-[#5c2417]',
    'bg-[#d9ece9] text-[#134540]',
];

export function initials(name: string | null | undefined): string {
    const parts = (name ?? '?').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, size = 44, group = false }: { name: string | null | undefined; size?: number; group?: boolean }) {
    let h = 0;
    for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const tint = AVATAR_TINTS[h % AVATAR_TINTS.length];
    return (
        <span
            aria-hidden
            className={`inline-flex shrink-0 items-center justify-center font-semibold ${group ? 'rounded-2xl' : 'rounded-full'} ${tint}`}
            style={{ width: size, height: size, fontSize: size * 0.36 }}
        >
            {initials(name)}
        </span>
    );
}

/** Page title bar used by every non-chat page. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 pb-4 sm:px-5 md:px-8 md:pt-6">
            <div className="min-w-0">
                <h1 className="text-xl font-bold break-words sm:text-2xl">{title}</h1>
                {description && <p className="mt-1 max-w-[60ch] text-[15px] text-muted">{description}</p>}
            </div>
            {actions && <div className="flex max-w-full flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
    return <div className={`w-full min-w-0 px-4 pb-10 sm:px-5 md:px-8 ${narrow ? 'max-w-3xl' : 'max-w-5xl'}`}>{children}</div>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-white text-leaf">{icon}</div>
            <p className="font-semibold text-grove">{title}</p>
            {children && <div className="mt-1 max-w-[42ch] text-sm text-muted">{children}</div>}
        </div>
    );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
    useEffect(() => {
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);
    return (
        <div className="fade-in fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-grove/40 sm:items-center sm:p-4" onClick={onClose}>
            <div role="dialog" aria-modal aria-label={title}
                className={`sheet-in scroll-area max-h-[92dvh] w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:rounded-3xl sm:pb-5 ${wide ? 'sm:max-w-xl' : 'sm:max-w-md'}`}
                onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="min-w-0 text-lg font-bold break-words">{title}</h2>
                    <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close"><X size={20} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

/** Small "x minutes ago" / clock formatter shared by lists. */
export function when(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    const days = (now.getTime() - d.getTime()) / 864e5;
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export const memberLabel = (t: string | null | undefined) =>
    ({ student: 'Student', staff: 'Staff', alumni: 'Alumni', parent: 'Parent or guardian', admin: 'Administrator' } as Record<string, string>)[t ?? ''] ?? '';

/** Previous / numbered pages / Next for long lists. */
export function Pager({ links }: { links: { url: string | null; label: string; active: boolean }[] }) {
    if (links.length <= 3) return null;
    return (
        <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center gap-1">
            {links.map((l, i) => {
                const edge = i === 0 || i === links.length - 1;
                // On phones only Previous, the current page and Next show, so the row never overflows.
                return (
                    <button key={i} disabled={!l.url} aria-current={l.active ? 'page' : undefined}
                        onClick={() => l.url && router.get(l.url, {}, { preserveState: true, preserveScroll: false })}
                        className={`min-w-9 rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${!edge && !l.active ? 'hidden sm:inline-block' : ''} ${l.active ? 'bg-grove text-white' : 'bg-white text-ink hover:bg-mint'}`}>
                        {l.label.replace('&laquo; Previous', '‹ Previous').replace('Next &raquo;', 'Next ›').replace('&hellip;', '…')}
                    </button>
                );
            })}
        </nav>
    );
}
