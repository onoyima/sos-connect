import { Head, Link, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { Building2, ChevronRight, CircleAlert, CircleCheck, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, Modal, PageBody, PageHeader, Stat } from '@/components/ui';
import { day, money, SUB_STATUS } from '@/lib/billing';

type Sub = { status: string; plan: string | null; cycle: string; renews_at: string | null; member_limit: number | null; price: number } | null;
type Inst = { id: number; name: string; short_code: string; country: string; status: string; contact_name: string; contact_email: string; dpo_email: string | null; dpa_version: string | null; dpa_accepted_by: string | null; verified_at: string | null; users_count: number; connector_ok: boolean; members: number; subscription: Sub };
type Stats = { counts: Record<string, number>; annual_revenue: number; monthly_revenue: number; trials_ending: number; open_invoices: number; open_amount: number; paid_30_days: number; currency: string };

const STATUS_TONE: Record<string, string> = { active: 'bg-mint text-grove', pending: 'bg-amber/25 text-[#7a4d0b]', suspended: 'bg-sos/10 text-sos' };

export default function Institutions({ institutions, stats, enforced }: { institutions: Inst[]; stats: Stats; enforced: boolean }) {
    const [acting, setActing] = useState<{ inst: Inst; status: string } | null>(null);
    const [note, setNote] = useState('');
    const [force, setForce] = useState(false);
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');

    const shown = useMemo(() => institutions.filter((i) => (filter === 'all' || i.subscription?.status === filter || (filter === 'pending' && i.status === 'pending'))
        && (!q || `${i.name} ${i.short_code} ${i.contact_email}`.toLowerCase().includes(q.toLowerCase()))), [institutions, filter, q]);

    return (
        <AppLayout title="Institutions">
            <Head title="Institutions" />
            <PageHeader title="Institutions" description="Every institution on SOS Connect, its subscription and how much of its plan it uses. Open one to change its plan, extend a trial or record a payment." />
            <PageBody>
                {!enforced && (
                    <div className="mb-4 flex items-start gap-2 rounded-2xl bg-[#e3eefc] px-4 py-3 text-sm">
                        <CircleAlert size={18} className="mt-0.5 shrink-0 text-[#1d4f91]" />
                        <p className="min-w-0 flex-1">Subscriptions are tracked but <strong>not enforced</strong>: every institution keeps all its features. Set prices under <Link href="/platform/plans" className="font-semibold text-leaf underline">Plans</Link>, then switch enforcement on under <Link href="/platform/billing" className="font-semibold text-leaf underline">Billing</Link>.</p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Monthly revenue (active)" value={money(stats.monthly_revenue, stats.currency)} hint={`${money(stats.annual_revenue, stats.currency)} a year`} />
                    <Stat label="Paid in the last 30 days" value={money(stats.paid_30_days, stats.currency)} />
                    <Stat label="Unpaid invoices" value={String(stats.open_invoices)} hint={money(stats.open_amount, stats.currency)} />
                    <Stat label="Trials ending this week" value={String(stats.trials_ending)} hint={`${stats.counts.trialing ?? 0} on trial`} />
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                        {[['all', `All (${institutions.length})`], ...Object.entries(SUB_STATUS).map(([k, v]) => [k, `${v.label} (${stats.counts[k] ?? 0})`]), ['pending', 'Not switched on']].map(([k, l]) => (
                            <button key={k} onClick={() => setFilter(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${filter === k ? 'bg-grove text-white' : 'bg-white text-ink hover:bg-mint'}`}>{l}</button>
                        ))}
                    </div>
                    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-3 py-2 sm:max-w-xs sm:ml-auto">
                        <Search size={16} className="shrink-0 text-muted" />
                        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search institutions" value={q} onChange={(e) => setQ(e.target.value)} />
                    </label>
                </div>

                {institutions.length === 0 && <EmptyState icon={<Building2 size={26} />} title="No institutions have registered yet">They sign up at /register-institution.</EmptyState>}
                <div className="mt-4 space-y-3">
                    {shown.map((i) => {
                        const s = i.subscription;
                        const st = s ? SUB_STATUS[s.status] : null;
                        const usage = s?.member_limit ? Math.min(100, Math.round((i.members / s.member_limit) * 100)) : null;
                        return (
                            <article key={i.id} className="rounded-2xl bg-white p-4 sm:p-5">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <Link href={`/platform/institutions/${i.id}`} className="group min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-lg font-bold group-hover:underline">{i.name}</h2>
                                            <span className="text-muted">{i.short_code}, {i.country}</span>
                                            <span className={`pill ${STATUS_TONE[i.status] ?? 'bg-mist text-muted'}`}>{i.status === 'active' ? 'switched on' : i.status}</span>
                                            {st && <span className={`pill ${st.tone}`}>{st.label}</span>}
                                        </div>
                                        <p className="text-[15px]">
                                            {s ? <><strong>{s.plan}</strong> plan, {s.cycle}{s.price ? `, ${money(s.price, stats.currency)}` : ''}{s.renews_at ? ` · ${s.status === 'trialing' ? 'trial ends' : 'renews'} ${day(s.renews_at)}` : ''}</> : 'No subscription yet'}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                                            <span>{i.members.toLocaleString()}{s?.member_limit ? ` of ${s.member_limit.toLocaleString()}` : ''} members</span>
                                            <span className={`inline-flex items-center gap-1 ${i.connector_ok ? 'text-leaf' : 'text-[#8a5a12]'}`}>
                                                {i.connector_ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}{i.connector_ok ? 'Records connected' : 'Records not connected'}
                                            </span>
                                            <span className="break-all">{i.contact_name}, {i.contact_email}</span>
                                        </div>
                                        {usage !== null && (
                                            <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-mist" title={`${usage}% of the member limit`}>
                                                <div className={`h-full rounded-full ${usage >= 90 ? 'bg-sos' : usage >= 75 ? 'bg-amber' : 'bg-leaf'}`} style={{ width: `${usage}%` }} />
                                            </div>
                                        )}
                                    </Link>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                        <Link href={`/platform/institutions/${i.id}`} className="btn-outline">Manage<ChevronRight size={16} /></Link>
                                        {i.status !== 'active' && <button className="btn-primary" onClick={() => { setNote(''); setForce(false); setActing({ inst: i, status: 'active' }); }}>Switch on</button>}
                                        {i.status === 'active' && <button className="btn-outline text-sos" onClick={() => { setNote(''); setActing({ inst: i, status: 'suspended' }); }}>Suspend</button>}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                    {institutions.length > 0 && shown.length === 0 && <p className="py-8 text-center text-muted">No institutions match.</p>}
                </div>
            </PageBody>

            {acting && (
                <Modal title={acting.status === 'active' ? `Switch on ${acting.inst.name}?` : `Suspend ${acting.inst.name}?`} onClose={() => setActing(null)}>
                    <p className="text-[15px]">{acting.status === 'active' ? 'Its members will be able to sign in straight away.' : 'All its members will be signed out and blocked until you switch it back on.'}</p>
                    {acting.status === 'active' && !acting.inst.connector_ok && (
                        <div className="mt-3 rounded-xl bg-amber/15 px-3 py-2.5 text-sm">
                            <p><strong>Its records connection isn't working yet.</strong> Its admins can sign in and finish setting up, but students and staff can't sign in until the institution connects its records (Settings &gt; Your records) and the test passes.</p>
                            <label className="mt-2 flex items-center gap-2 font-medium">
                                <input type="checkbox" className="size-4 accent-leaf" checked={force} onChange={(e) => setForce(e.target.checked)} />
                                Switch on anyway
                            </label>
                        </div>
                    )}
                    <label className="label mt-4" htmlFor="inst-note">Note for the audit log</label>
                    <textarea id="inst-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={acting.status === 'active' ? 'Letter of authority received from the Registrar, 9 Nov.' : 'Contract ended.'} />
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setActing(null)}>Cancel</button>
                        <button className={acting.status === 'active' ? 'btn-primary' : 'btn-danger'} disabled={acting.status === 'active' && !acting.inst.connector_ok && !force}
                            onClick={() => { router.post(`/platform/institutions/${acting.inst.id}/status`, { status: acting.status, note, force }, { preserveScroll: true }); setActing(null); }}>
                            {acting.status === 'active' ? 'Switch on' : 'Suspend'}
                        </button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}

