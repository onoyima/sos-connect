/** Money is stored in the smallest unit (kobo, cents). */
export function money(minor: number | null | undefined, currency: string): string {
    const n = (minor ?? 0) / 100;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
    } catch {
        return `${currency} ${n.toLocaleString()}`;
    }
}
/** "150,000" or "150000.50" typed in a box → smallest unit. */
export const toMinor = (s: string): number => Math.round((parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0) * 100);
export const fromMinor = (m: number | null | undefined): string => (m === null || m === undefined ? '' : String(m / 100));

export const SUB_STATUS: Record<string, { label: string; tone: string }> = {
    trialing: { label: 'Free trial', tone: 'bg-[#e3eefc] text-[#1d4f91]' },
    active: { label: 'Active', tone: 'bg-mint text-grove' },
    past_due: { label: 'Payment due', tone: 'bg-amber/25 text-[#7a4d0b]' },
    expired: { label: 'Lapsed', tone: 'bg-sos/10 text-sos' },
    cancelled: { label: 'Cancelled', tone: 'bg-line text-muted' },
};

export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const isoDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
