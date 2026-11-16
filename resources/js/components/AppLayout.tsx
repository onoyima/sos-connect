import { Link, router, usePage } from '@inertiajs/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
    LifeBuoy, ScanFace, Headset,
    Bell, CircleAlert, CircleCheck, CircleDot, Ellipsis, LogOut, Megaphone, Menu, MessageCircle, Phone, Settings, ShieldCheck, Siren, ScrollText, LockKeyhole, WifiOff, X,
} from 'lucide-react';
import { isLive, listenInstitution, listenUser, onBadges, onChange, startLive, type Badges } from '@/lib/live';
import { askSignOut, sessionEnded, signOut, watchSession } from '@/lib/session';
import type { SharedProps } from '@/types';
import { Broadcasts } from './Broadcasts';
import { CallManager } from './CallManager';
import { PolicyGate } from './PolicyGate';
import { SosButton } from './SosButton';
import { PlatformChat } from './PlatformChat';
import { Avatar, memberLabel } from './ui';
import { BrandMark } from './AuthShell';

type NavItem = { href: string; label: string; icon: typeof MessageCircle; permission?: string | string[]; module?: string | string[] };

const MAIN: NavItem[] = [
    { href: '/chats', label: 'Chats', icon: MessageCircle },
    { href: '/announcements', label: 'Notices', icon: Megaphone, permission: 'announcements.view', module: 'announcements' },
    { href: '/status', label: 'Status', icon: CircleDot, module: 'status' },
    { href: '/calls', label: 'Calls', icon: Phone, module: ['voice_calls', 'video_calls'] },
    { href: '/sos', label: 'Alerts', icon: Siren },
    { href: '/safety', label: 'Safety', icon: ShieldCheck, module: 'safety_checks' },
];

/** Admin pages share one rail entry; tabs inside the page switch between them. Each shows only with its permission. */
export const ADMIN_TABS: NavItem[] = [
    { href: '/admin/members', label: 'Members', icon: Settings, permission: 'members.view' },
    { href: '/admin/roles', label: 'Roles', icon: Settings, permission: 'roles.view' },
    { href: '/admin/groups', label: 'Groups', icon: Settings, permission: 'groups.view' },
    { href: '/admin/structure', label: 'Faculties and units', icon: Settings, permission: 'units.view' },
    { href: '/admin/parents', label: 'Parents', icon: Settings, permission: 'parents.invite', module: 'parents' },
    { href: '/admin/broadcasts', label: 'Pop-ups and marquee', icon: Settings, permission: 'broadcasts.manage', module: 'broadcasts' },
    { href: '/admin/faces', label: 'Face capture', icon: Settings, permission: 'faces.view', module: 'face_capture' },
    { href: '/admin/modules', label: 'Features', icon: Settings, permission: 'modules.manage' },
    { href: '/admin/settings', label: 'Settings', icon: Settings, permission: ['settings.edit', 'connector.edit'] },
    { href: '/admin/reports', label: 'Reports', icon: Settings, permission: ['reports.view', 'data_requests.view'] },
    { href: '/admin/audit', label: 'Audit log', icon: Settings, permission: 'audit.view' },
    { href: '/admin/branding', label: 'Look and icons', icon: Settings, permission: 'branding.manage' },
    { href: '/admin/design', label: 'Design document', icon: Settings, permission: 'design.view' },
    { href: '/platform/institutions', label: 'Institutions', icon: Settings, permission: 'platform.manage' },
];

export default function AppLayout({ title, children, hideMobileNav = false }: { title: string; children: ReactNode; hideMobileNav?: boolean }) {
    const { auth, institution, flash, reverb, modules } = usePage<SharedProps>().props;
    const url = usePage().url;
    const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
    const [banner, setBanner] = useState<{ text: string; href: string; calm?: boolean } | null>(null);
    const [flashOpen, setFlashOpen] = useState(true);
    const [menu, setMenu] = useState(false);
    const [drawer, setDrawer] = useState(false);
    // Unread platform-chat messages (the chat button is in the phone top bar; on bigger screens it floats).
    const [pcUnread, setPcUnread] = useState(0);
    useEffect(() => {
        const f = (e: Event) => setPcUnread((e as CustomEvent<number>).detail ?? 0);
        window.addEventListener('sos:platform-chat-unread', f);
        return () => window.removeEventListener('sos:platform-chat-unread', f);
    }, []);
    // "Remind me later" hides the face capture reminder until the next time the site is opened.
    const [faceLater, setFaceLater] = useState(() => { try { return sessionStorage.getItem('sos.faceLater') === '1'; } catch { return false; } });
    const [badges, setBadges] = useState<Badges>({ chats: 0, calls: 0, requests: 0 });
    const countFor = (href: string) => (href === '/chats' ? badges.chats + badges.requests : href === '/calls' ? badges.calls : 0);
    const has = (p?: string | string[]) => !p || (Array.isArray(p) ? p : [p]).some((x) => !!auth?.permissions.includes(x));
    const on = (m?: string | string[]) => !m || (Array.isArray(m) ? m : [m]).some((x) => modules?.[x] !== false);
    const can = (p?: string | string[]) => has(p);
    const shows = (n: NavItem) => has(n.permission) && on(n.module);
    // The platform owner belongs to no school: no chats, SOS or notices to show, only the institutions list.
    const platformOnly = !!auth?.user.is_platform_admin && !institution;
    const main = platformOnly ? [] : MAIN.filter(shows);
    const adminHref = ADMIN_TABS.find(shows)?.href;
    const isActive = (href: string) => url === href || url.startsWith(href + '/') || url.startsWith(href + '?');
    const inAdmin = url.startsWith('/admin') || url.startsWith('/platform');

    useEffect(() => setFlashOpen(true), [flash?.status, flash?.error]);
    // Success messages tidy themselves away; errors stay until dismissed.
    useEffect(() => {
        if (!flash?.status || flash?.error) return;
        const t = setTimeout(() => setFlashOpen(false), 8000);
        return () => clearTimeout(t);
    }, [flash?.status, flash?.error]);
    useEffect(() => { watchSession(); }, []);
    // Sign out asks first.
    const [confirmOut, setConfirmOut] = useState(false);
    useEffect(() => {
        const ask = () => { setMenu(false); setDrawer(false); setConfirmOut(true); };
        window.addEventListener('sos:ask-sign-out', ask);
        return () => window.removeEventListener('sos:ask-sign-out', ask);
    }, []);
    // One browser at a time: opened on another browser (or signed out from the phone) -> this page signs out at once.
    useEffect(() => listenUser('session.replaced', (e: { device: string; keep: string | null }) => {
        if (e.device === 'web' && e.keep !== auth?.session_tag) sessionEnded(e.keep ? 'replaced' : 'phone');
    }), [auth?.session_tag]);
    // Moving to another page closes any open menu.
    useEffect(() => { setDrawer(false); setMenu(false); }, [url]);

    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);

    // Live updates for every page (websocket, or checking every few seconds when it can't connect).
    useEffect(() => { if (auth) startLive(reverb, auth.user.id, institution?.id ?? null); }, [auth?.user.id]);

    // Institution-wide events: urgent announcements and safety checks appear on every page.
    useEffect(() => {
        const a = listenInstitution('safety_check.issued', (e: { title: string }) => setBanner({ text: `Safety check: ${e.title}. Tap to say you're safe.`, href: '/safety' }));
        const b = listenInstitution('announcement.published', (e: { title: string }) => setBanner({ text: `New notice: ${e.title}`, href: '/announcements' }));
        return () => { a(); b(); };
    }, []);

    // Red counts: chats with unread messages (plus chat requests) and missed calls, also in the browser tab title.
    useEffect(() => onBadges(setBadges), []);
    useEffect(() => {
        const total = badges.chats + badges.calls + badges.requests;
        const base = document.title.replace(/^\(\d+\) /, '');
        document.title = total > 0 ? `(${total}) ${base}` : base;
    }, [badges, url]);

    // Someone tagged me in a status, or commented on mine.
    useEffect(() => {
        if (!auth) return;
        const show = (e: { title: string }) => setBanner({ text: e.title, href: '/status', calm: true });
        const offs = ['status.tagged', 'status.commented', 'status.reacted'].map((k) => listenUser(k, show));
        offs.push(listenUser('chat_request.received', (e: { from: { name: string } }) => setBanner({ text: `${e.from.name} wants to chat with you. Tap to accept or decline.`, href: '/chats', calm: true })));
        offs.push(listenUser('chat_request.declined', (e: { by: { name: string } }) => setBanner({ text: `${e.by.name} can't chat right now.`, href: '/chats', calm: true })));
        offs.push(listenUser('chat_request.accepted', (e: { by: { name: string }; conversation_id: number }) => setBanner({ text: `${e.by.name} accepted your chat request. Tap to chat.`, href: `/chats/${e.conversation_id}`, calm: true })));
        return () => offs.forEach((f) => f());
    }, [auth?.user.id]);

    // Without the websocket, new safety checks and notices still show their banner (found by the regular check).
    useEffect(() => {
        const isNew = (stamp: string, before: string) => before !== '' && Number(stamp.split('|')[0] || 0) > Number(before.split('|')[0] || 0);
        const a = onChange('safety', (s, b) => { if (!isLive() && isNew(s, b)) setBanner({ text: "New safety check. Tap to say you're safe.", href: '/safety' }); });
        const n = onChange('announcements', (s, b) => { if (!isLive() && isNew(s, b)) setBanner({ text: 'New notice. Tap to read it.', href: '/announcements' }); });
        return () => { a(); n(); };
    }, []);

    return (
        // The frame is pinned to the screen: only the content area scrolls, so dragging never moves or shakes the whole page.
        <div className="fixed inset-0 flex flex-col overflow-hidden md:flex-row">

            {/* Desktop and tablet rail. Scrolls by itself on short screens. */}
            <aside className="no-scrollbar hidden w-[84px] shrink-0 flex-col items-center overflow-y-auto overscroll-contain bg-grove py-4 text-white md:flex">
                <Link href="/chats" className="mb-4 flex shrink-0 flex-col items-center" aria-label="SOS Connect home">
                    <Logo />
                </Link>
                {can('sos.raise') && <div className="shrink-0"><SosButton variant="rail" /></div>}
                <nav className="mt-4 flex flex-col items-center gap-1" aria-label="Main">
                    {main.map((n) => <RailLink key={n.href} item={n} active={isActive(n.href)} count={countFor(n.href)} />)}
                    {adminHref && <RailLink item={{ href: adminHref, label: 'Admin', icon: Settings }} active={inAdmin} />}
                </nav>
                <div className="mt-auto shrink-0 pt-4">
                    <button onClick={() => setMenu((m) => !m)} className="rounded-full ring-2 ring-transparent transition hover:ring-white/40" aria-label="Account menu" aria-expanded={menu}>
                        <Avatar name={auth?.user.name} size={40} />
                    </button>
                </div>
            </aside>
            {menu && <div className="hidden md:block"><AccountMenu onClose={() => setMenu(false)} placement="rail" /></div>}

            {/* Phone top bar with the menu button that opens the sidebar */}
            {!hideMobileNav && (
                <header className="flex shrink-0 items-center gap-2 bg-grove px-2 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 text-white md:hidden">
                    <button onClick={() => setDrawer(true)} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10" aria-label="Open menu" aria-expanded={drawer}>
                        <span className="relative"><Menu size={22} />{badges.chats + badges.calls + badges.requests > 0 && <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-sos ring-2 ring-grove" />}</span>
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{title}</div>
                        <div className="truncate text-xs text-white/60">{institution?.name}</div>
                    </div>
                    {auth?.platform_chat && (
                        <button onClick={() => window.dispatchEvent(new Event('sos:platform-chat'))} aria-label={pcUnread ? `Platform chat, ${pcUnread} unread` : 'Platform chat'}
                            className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
                            <Headset size={21} />
                            {pcUnread > 0 && <span className="absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[10px] font-bold text-ink">{pcUnread > 99 ? '99+' : pcUnread}</span>}
                        </button>
                    )}
                    <Link href="/chats" aria-label="Home" className="shrink-0 pr-1"><Logo small /></Link>
                </header>
            )}
            {confirmOut && <SignOutDialog onCancel={() => setConfirmOut(false)} onConfirm={() => { setConfirmOut(false); signOut(); }} />}
            {drawer && (
                <Drawer onClose={() => setDrawer(false)} main={main} admin={ADMIN_TABS.filter(shows)} isActive={isActive} canSos={can('sos.raise')} countFor={countFor} />
            )}

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {modules?.broadcasts !== false && auth && <Broadcasts />}
                {!online && (
                    <div className="flex items-start gap-2 bg-amber/20 px-4 py-2.5 text-sm text-ink">
                        <WifiOff size={18} className="mt-0.5 shrink-0 text-[#8a5a12]" />
                        <span>
                            You're offline. The website needs internet, but the phone app keeps working over Wi-Fi and Bluetooth.
                            {institution && <> In an emergency call <strong>{(institution.emergency_numbers ?? ['112']).join(' or ')}</strong>{institution.security_phone && <> or campus security on <strong>{institution.security_phone}</strong></>}.</>}
                        </span>
                    </div>
                )}
                {auth?.face_due && !url.startsWith('/face') && !faceLater && (
                    <div className="flex items-center gap-2 bg-amber/25 px-4 py-2.5 text-sm text-ink">
                        <ScanFace size={18} className="shrink-0 text-[#7a4d0b]" />
                        <Link href="/face" className="min-w-0 flex-1 font-medium break-words">Your institution asks everyone to capture their face. It takes about a minute. Start now</Link>
                        <button aria-label="Remind me later" className="shrink-0" onClick={() => { setFaceLater(true); try { sessionStorage.setItem('sos.faceLater', '1'); } catch { /* private mode */ } }}><X size={18} /></button>
                    </div>
                )}
                {banner && (
                    <div className={`flex items-center gap-2 px-4 py-2.5 text-sm text-white ${banner.calm ? 'bg-leaf' : 'bg-sos'}`}>
                        <Bell size={18} className="shrink-0" />
                        <button className="min-w-0 flex-1 text-left font-medium break-words" onClick={() => { router.visit(banner.href); setBanner(null); }}>{banner.text}</button>
                        <button aria-label="Dismiss" className="shrink-0" onClick={() => setBanner(null)}><X size={18} /></button>
                    </div>
                )}
                {flash?.error && flashOpen && (
                    <div role="alert" className="flex items-center gap-2 bg-sos/10 px-4 py-2.5 text-sm text-sos">
                        <CircleAlert size={18} className="shrink-0" />
                        <span className="min-w-0 flex-1 break-words">{flash.error}</span>
                        <button aria-label="Dismiss" className="shrink-0" onClick={() => setFlashOpen(false)}><X size={18} /></button>
                    </div>
                )}
                {flash?.status && !flash?.error && flashOpen && (
                    <div role="status" className="flex items-center gap-2 bg-mint px-4 py-2.5 text-sm text-grove">
                        <CircleCheck size={18} className="shrink-0" />
                        <span className="min-w-0 flex-1 break-words">{flash.status}</span>
                        <button aria-label="Dismiss" className="shrink-0" onClick={() => setFlashOpen(false)}><X size={18} /></button>
                    </div>
                )}
                {inAdmin && <AdminTabs shows={shows} isActive={isActive} />}
                <div className="scroll-area min-h-0 min-w-0 flex-1">{children}</div>
            </main>

            {/* Mobile bottom tabs */}
            {!hideMobileNav && (
                <nav className="relative grid shrink-0 grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
                    <TabLink item={MAIN[0]} active={isActive('/chats')} count={countFor('/chats')} />
                    {shows(MAIN[1]) ? <TabLink item={MAIN[1]} active={isActive('/announcements')} /> : <TabLink item={MAIN[4]} active={isActive('/sos')} />}
                    <div className="flex justify-center">{can('sos.raise') ? <SosButton variant="tab" /> : <TabLink item={MAIN[4]} active={isActive('/sos')} />}</div>
                    {shows(MAIN[3]) ? <TabLink item={MAIN[3]} active={isActive('/calls')} count={countFor('/calls')} /> : <TabLink item={MAIN[5]} active={isActive('/safety')} />}
                    <button onClick={() => setMenu(true)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${menu ? 'text-leaf' : 'text-muted'}`}>
                        <Ellipsis size={22} />More
                    </button>
                    {menu && <AccountMenu onClose={() => setMenu(false)} placement="sheet" extra={[...main.filter((n) => !['/chats', '/announcements', '/calls'].includes(n.href)), ...(adminHref ? [{ href: adminHref, label: 'Admin', icon: Settings }] : [])]} />}
                </nav>
            )}

            {auth?.user.needs_policy_acceptance && <PolicyGate />}
            {auth && <CallManager />}
            {auth?.platform_chat && <PlatformChat lifted={url.startsWith('/chats')} />}
        </div>
    );
}

function Logo({ small = false }: { small?: boolean }) {
    return <BrandMark size={small ? 32 : 40} />;
}

/** Red count on a nav icon. */
export function Count({ n, className = '' }: { n: number; className?: string }) {
    if (n <= 0) return null;
    return (
        <span className={`absolute -top-1 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sos px-1 text-[10.5px] leading-none font-bold text-white ring-2 ring-white ${className}`}>
            {n > 99 ? '99+' : n}
        </span>
    );
}

function RailLink({ item, active, count = 0 }: { item: NavItem; active: boolean; count?: number }) {
    const Icon = item.icon;
    return (
        <Link href={item.href} aria-current={active ? 'page' : undefined} aria-label={count ? `${item.label}, ${count} new` : undefined}
            className={`flex w-[68px] flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors ${active ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/8 hover:text-white'}`}>
            <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-leaf' : ''}`}><Icon size={20} /><Count n={count} className="ring-grove" /></span>
            {item.label}
        </Link>
    );
}

function TabLink({ item, active, count = 0 }: { item: NavItem; active: boolean; count?: number }) {
    const Icon = item.icon;
    return (
        <Link href={item.href} aria-current={active ? 'page' : undefined} aria-label={count ? `${item.label}, ${count} new` : undefined}
            className={`flex min-w-0 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? 'text-leaf' : 'text-muted'}`}>
            <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-mint' : ''}`}><Icon size={21} /><Count n={count} /></span>
            <span className="max-w-full truncate px-0.5">{item.label}</span>
        </Link>
    );
}

/** Phone and small-tablet sidebar: everything the rail has, plus the admin pages, sliding in from the left. */
function Drawer({ onClose, main, admin, isActive, canSos, countFor }: { onClose: () => void; main: NavItem[]; admin: NavItem[]; isActive: (h: string) => boolean; canSos: boolean; countFor: (h: string) => number }) {
    const { auth, institution } = usePage<SharedProps>().props;
    useEffect(() => {
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [onClose]);
    const row = (active: boolean) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium ${active ? 'bg-white/12 text-white' : 'text-white/75 hover:bg-white/8 hover:text-white'}`;
    return (
        <div className="fade-in fixed inset-0 z-50 md:hidden" role="dialog" aria-modal aria-label="Menu">
            <div className="absolute inset-0 bg-grove/50" onClick={onClose} />
            <aside className="drawer-in scroll-area absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-grove pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+12px)] text-white shadow-2xl">
                <div className="flex items-center gap-3 px-4 pb-4">
                    <BrandMark size={36} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">SOS Connect</div>
                        <div className="truncate text-xs text-white/60">{institution?.name}</div>
                    </div>
                    <button onClick={onClose} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close menu"><X size={22} /></button>
                </div>
                {canSos && <div className="px-4 pb-3"><Link href="/sos" className="btn-danger w-full" onClick={onClose}><Siren size={18} />Get help now</Link></div>}
                <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
                    {main.map((n) => {
                        const Icon = n.icon;
                        const n2 = countFor(n.href);
                        return (
                            <Link key={n.href} href={n.href} className={row(isActive(n.href))} aria-current={isActive(n.href) ? 'page' : undefined} onClick={onClose}>
                                <Icon size={20} /><span className="flex-1">{n.label}</span>
                                {n2 > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sos px-1.5 text-[11px] font-bold text-white">{n2 > 99 ? '99+' : n2}</span>}
                            </Link>
                        );
                    })}
                </nav>
                {admin.length > 0 && (
                    <>
                        <div className="mt-4 px-5 pb-1 text-xs font-semibold tracking-wide text-white/45 uppercase">Admin</div>
                        <nav className="flex flex-col gap-0.5 px-2" aria-label="Admin">
                            {admin.map((n) => <Link key={n.href} href={n.href} className={row(isActive(n.href))} aria-current={isActive(n.href) ? 'page' : undefined} onClick={onClose}><Settings size={18} />{n.label}</Link>)}
                        </nav>
                    </>
                )}
                <div className="mt-auto border-t border-white/10 px-2 pt-3">
                    <div className="flex items-center gap-3 px-3 pb-2">
                        <Avatar name={auth?.user.name} size={36} />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{auth?.user.name}</div>
                            <div className="truncate text-xs text-white/60">{auth?.user.title ?? memberLabel(auth?.user.member_type)}</div>
                        </div>
                    </div>
                    <Link href="/account/privacy" className={row(isActive('/account/privacy'))} onClick={onClose}><LockKeyhole size={18} />My data and privacy</Link>
                    <Link href="/legal" className={row(isActive('/legal'))} onClick={onClose}><ScrollText size={18} />Terms and policies</Link>
                    <button className={`${row(false)} w-full text-left text-[#ff9aa4]`} onClick={askSignOut}><LogOut size={18} />Sign out</button>
                </div>
            </aside>
        </div>
    );
}

function AdminTabs({ shows, isActive }: { shows: (n: NavItem) => boolean; isActive: (h: string) => boolean }) {
    const tabs = ADMIN_TABS.filter(shows);
    const bar = useRef<HTMLDivElement>(null);
    // Bring the open tab into view when the row is wider than the screen.
    useEffect(() => { bar.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, []);
    if (tabs.length < 2) return null;
    return (
        <div ref={bar} className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-b border-line bg-white px-3 md:px-6">
            {tabs.map((t) => (
                <Link key={t.href} href={t.href} aria-current={isActive(t.href) ? 'page' : undefined}
                    className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${isActive(t.href) ? 'border-leaf text-grove' : 'border-transparent text-muted hover:text-ink'}`}>
                    {t.label}
                </Link>
            ))}
        </div>
    );
}

function AccountMenu({ onClose, placement, extra = [] }: { onClose: () => void; placement: 'rail' | 'sheet'; extra?: NavItem[] }) {
    const { auth, institution, modules } = usePage<SharedProps>().props;
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        setTimeout(() => document.addEventListener('click', click));
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', esc); };
    }, [onClose]);

    const row = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink hover:bg-mist';
    const body = (
        <>
            <div className="flex items-center gap-3 px-3 pt-1 pb-3">
                <Avatar name={auth?.user.name} size={44} />
                <div className="min-w-0">
                    <div className="truncate font-semibold text-grove">{auth?.user.name}</div>
                    <div className="truncate text-xs text-muted">{auth?.user.title ?? memberLabel(auth?.user.member_type)}{institution ? `, ${institution.short_code}` : ''}</div>
                </div>
            </div>
            {extra.map((n) => {
                const Icon = n.icon;
                return <Link key={n.href} href={n.href} className={row} onClick={onClose}><Icon size={18} className="text-muted" />{n.label}</Link>;
            })}
            {modules?.face_capture && auth?.permissions.includes('face.capture') && <Link href="/face" className={row} onClick={onClose}><ScanFace size={18} className="text-muted" />Face capture</Link>}
            <Link href="/help" className={row} onClick={onClose}><LifeBuoy size={18} className="text-muted" />Help</Link>
            <Link href="/account/privacy" className={row} onClick={onClose}><LockKeyhole size={18} className="text-muted" />My data and privacy</Link>
            <Link href="/legal" className={row} onClick={onClose}><ScrollText size={18} className="text-muted" />Terms and policies</Link>
            <button className={`${row} text-sos`} onClick={askSignOut}><LogOut size={18} />Sign out</button>
        </>
    );

    if (placement === 'rail') {
        return <div ref={ref} className="scroll-area fixed bottom-4 left-[76px] z-40 max-h-[calc(100dvh-2rem)] w-64 rounded-2xl border border-line bg-white p-2 shadow-[0_12px_32px_rgba(14,59,46,0.18)]">{body}</div>;
    }
    return (
        <div className="fade-in fixed inset-0 z-40 flex items-end bg-grove/40">
            <div ref={ref} className="sheet-in scroll-area max-h-[85dvh] w-full rounded-t-3xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
                {body}
            </div>
        </div>
    );
}

/** "Sign out?" — signing out by accident means scanning or typing the password again. */
function SignOutDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    const yes = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        yes.current?.focus();
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onCancel]);
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="signout-title" aria-describedby="signout-text"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 id="signout-title" className="text-lg font-bold text-ink">Sign out?</h2>
                <p id="signout-text" className="mt-2 text-[15px] text-muted">You'll need to sign in again, or link this browser from your phone, to use SOS Connect here.</p>
                <div className="mt-6 flex justify-end gap-2">
                    <button className="btn-ghost px-4" onClick={onCancel}>Cancel</button>
                    <button ref={yes} className="btn-danger px-4" onClick={onConfirm}>Sign out</button>
                </div>
            </div>
        </div>
    );
}
