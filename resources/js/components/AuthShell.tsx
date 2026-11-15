import { Link, usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, KeyRound, Radio, Siren } from 'lucide-react';
import type { SharedProps } from '@/types';

/** Public pages (sign in, register) share this frame: brand panel on the left, the form on the right. */
export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    const flash = (usePage<SharedProps>().props.flash ?? {}) as SharedProps['flash'];
    return (
        <div className="flex min-h-full flex-col lg:flex-row">
            <aside className="relative overflow-hidden bg-grove px-6 py-8 text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[42%] lg:flex-col lg:px-12 lg:py-12">
                <Waves />
                <Link href="/" className="relative flex items-center gap-3">
                    <BrandMark />
                    <span className="text-lg font-bold">SOS Connect</span>
                </Link>
                <div className="relative mt-8 hidden lg:mt-auto lg:block">
                    <p className="max-w-[18ch] text-[2.6rem] leading-[1.1] font-bold text-white">Your campus, still talking when the network isn't.</p>
                    <ul className="mt-10 max-w-sm space-y-5 text-[15px] text-white/80">
                        <li className="flex gap-3"><Radio size={20} className="mt-0.5 shrink-0 text-[#8fd3b4]" />Messages hop phone to phone over Wi-Fi and Bluetooth when there's no data.</li>
                        <li className="flex gap-3"><Siren size={20} className="mt-0.5 shrink-0 text-[#ff8b96]" />One SOS reaches campus security, the clinic and nearby phones at once.</li>
                        <li className="flex gap-3"><KeyRound size={20} className="mt-0.5 shrink-0 text-[#8fd3b4]" />Sign in with your school portal details. Your password stays with your school.</li>
                    </ul>
                </div>
            </aside>
            <main className="flex min-w-0 flex-1 items-start justify-center px-4 py-8 sm:px-5 lg:items-center lg:py-12">
                <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-sm'}`}>
                    {flash?.error && <p role="alert" className="mb-5 flex gap-2 rounded-xl bg-sos/10 px-3 py-2.5 text-sm text-sos"><CircleAlert size={18} className="mt-px shrink-0" />{flash.error}</p>}
                    {flash?.status && <p role="status" className="mb-5 flex gap-2 rounded-xl bg-mint px-3 py-2.5 text-sm text-grove"><CircleCheck size={18} className="mt-px shrink-0" />{flash.status}</p>}
                    {children}
                </div>
            </main>
        </div>
    );
}

/**
 * The chat icon: the institution's own (if an admin uploaded one) or the built-in mark, with a small seasonal
 * badge around celebrations (Christmas, Easter, Eid, Independence Day…).
 */
export function BrandMark({ size = 40 }: { size?: number }) {
    const branding = (usePage<SharedProps>().props.branding ?? null) as SharedProps['branding'] | null;
    const season = branding?.season;
    return (
        <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={season ? `Happy ${season.label}!` : undefined}>
            {branding?.icon ? <img src={branding.icon} alt="" width={size} height={size} className="size-full rounded-[30%] object-cover" /> : <Mark size={size} />}
            {season && (
                <span aria-hidden className="absolute -right-1.5 -bottom-1.5 flex items-center justify-center rounded-full bg-white shadow-sm"
                    style={{ width: size * 0.55, height: size * 0.55, fontSize: size * 0.36, boxShadow: `0 0 0 2px ${season.accent}` }}>{season.badge}</span>
            )}
        </span>
    );
}

export function Mark({ size = 40 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
            <rect width="40" height="40" rx="12" fill="#1e7b57" />
            <circle cx="14" cy="26" r="3.2" fill="#fff" />
            <path d="M14 18.5a7.5 7.5 0 0 1 7.5 7.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <path d="M14 12a14 14 0 0 1 14 14" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".55" />
            <circle cx="29" cy="11" r="4" fill="#d62839" />
        </svg>
    );
}

/** Rings spreading from the corner: the same idea as the mark, a signal passing outward. */
function Waves() {
    return (
        <svg className="pointer-events-none absolute -right-40 -bottom-40 hidden h-[560px] w-[560px] lg:block" viewBox="0 0 560 560" aria-hidden>
            {[90, 170, 250, 330, 410].map((r, i) => (
                <circle key={r} cx="560" cy="560" r={r} fill="none" stroke="#fff" strokeOpacity={0.09 - i * 0.012} strokeWidth="2" />
            ))}
        </svg>
    );
}
