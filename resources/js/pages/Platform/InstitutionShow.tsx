import { Head, Link, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowLeft, CalendarPlus, CircleAlert, CircleCheck, FilePlus2, ReceiptText } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Modal, PageBody, Stat } from '@/components/ui';
import { day, fromMinor, isoDate, money, SUB_STATUS, toMinor } from '@/lib/billing';

type Plan = { id: number; name: string; slug: string; price_monthly: number; price_yearly: number; max_members: number | null; is_active: boolean };
type Sub = { id: number; status: string; cycle: string; plan_id: number; plan: string | null; member_limit: number | null; price: number; cancel_at_period_end: boolean;
    max_members_override: number | null; price_override: number | null; notes: string | null; trial_ends_at: string | null; current_period_start: string | null;
    current_period_end: string | null; past_due_at: string | null; days_left: number | null; grace_ends_at: string | null };
type Invoice = { id: number; number: string; description: string; amount: number; currency: string; status: string; plan: string | null; cycle: string | null;
    due_at: string | null; paid_at: string | null; method_label: string | null; reference: string | null; overdue: boolean };
type Inst = { id: number; name: string; short_code: string; country: string; status: string; contact_name: string; contact_email: string; contact_phone: string | null;
    dpo_name: string | null; dpo_email: string | null; security_phone: string | null; verified_at: string | null; created_at: string; connector_ok: boolean; members: number; all_users: number };
type Props = { institution: Inst; subscription: Sub; invoices: Invoice[]; plans: Plan[]; methods: Record<string, string>; currency: string; enforced: boolean;
    audit: { id: number; action: string; meta: Record<string, unknown> | null; created_at: string }[] };

const ACTIONS: Record<string, string> = {
    'billing.subscription_changed': 'Subscription changed', 'billing.trial_extended': 'Trial extended', 'billing.invoice_created': 'Invoice created',
    'billing.invoice_paid': 'Payment recorded', 'billing.invoice_void': 'Invoice cancelled', 'billing.past_due': 'Payment became due',
    'billing.expired': 'Subscription lapsed', 'billing.plan_chosen': 'Plan chosen by the school', 'billing.plan_requested': 'Plan change requested',
    'billing.cancel_requested': 'Cancellation requested', 'billing.cancel_withdrawn': 'Cancellation withdrawn', 'billing.member_limit_reached': 'Member limit reached',
    'institution.active': 'Switched on', 'institution.suspended': 'Suspended', 'institution.pending': 'Set to pending', 'institution.details_updated': 'Details edited by the school',
};

export default function InstitutionShow({ institution: i, subscription: s, invoices, plans, methods, currency, enforced, audit }: Props) {
    const st = SUB_STATUS[s.status];
    const form = useForm({
        plan_id: s.plan_id, cycle: s.cycle, status: s.status, trial_ends_at: isoDate(s.trial_ends_at), current_period_end: isoDate(s.current_period_end),
        max_members_override: s.max_members_override ? String(s.max_members_override) : '', price_override: fromMinor(s.price_override),
        cancel_at_period_end: s.cancel_at_period_end, notes: s.notes ?? '',
    });
    const [paying, setPaying] = useState<Invoice | null>(null);
    const [newInvoice, setNewInvoice] = useState(false);
    const usage = s.member_limit ? Math.min(100, Math.round((i.members / s.member_limit) * 100)) : null;

    const save = (e: React.FormEvent) => {
        e.preventDefault();
        form.transform((d) => ({ ...d, max_members_override: d.max_members_override ? Number(d.max_members_override) : null,
            price_override: d.price_override === '' ? null : toMinor(d.price_override), trial_ends_at: d.trial_ends_at || null, current_period_end: d.current_period_end || null }));
        form.post(`/platform/institutions/${i.id}/subscription`, { preserveScroll: true });
    };

    return (
        <AppLayout title={i.name}>
            <Head title={i.name} />
            <PageBody>
                <Link href="/platform/institutions" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-leaf"><ArrowLeft size={16} />All institutions</Link>
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="min-w-0 text-2xl font-bold break-words">{i.name}</h1>
                    <span className="text-muted">{i.short_code}, {i.country}</span>
                    {st && <span className={`pill ${st.tone}`}>{st.label}</span>}
                    {s.cancel_at_period_end && <span className="pill bg-line text-muted">ends at period end</span>}
                </div>
                {!enforced && <p className="mt-1 text-sm text-muted">Subscriptions aren't enforced yet, so nothing is limited for this institution.</p>}

                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Plan" value={s.plan ?? '—'} hint={`${s.cycle}, ${money(s.price, currency)}`} />
                    <Stat label={s.status === 'trialing' ? 'Trial ends' : 'Paid until'} value={day(s.status === 'trialing' ? s.trial_ends_at : s.current_period_end)}
                        hint={s.days_left !== null ? `${s.days_left} day${s.days_left === 1 ? '' : 's'} left` : undefined} />
                    <Stat label="Members" value={i.members.toLocaleString()} hint={s.member_limit ? `of ${s.member_limit.toLocaleString()} allowed` : 'no limit'} />
                    <Stat label="Unpaid" value={money(invoices.filter((v) => v.status === 'open').reduce((a, v) => a + v.amount, 0), currency)}
                        hint={`${invoices.filter((v) => v.status === 'open').length} open invoice(s)`} />
                </div>
                {usage !== null && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white" title={`${usage}% of the member limit`}>
                        <div className={`h-full rounded-full ${usage >= 90 ? 'bg-sos' : usage >= 75 ? 'bg-amber' : 'bg-leaf'}`} style={{ width: `${usage}%` }} />
                    </div>
                )}
                {s.status === 'past_due' && s.grace_ends_at && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber/20 px-3 py-2 text-sm"><CircleAlert size={16} className="mt-0.5 shrink-0" />Payment due since {day(s.past_due_at)}. It lapses on {day(s.grace_ends_at)} if unpaid.</p>
                )}

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Subscription</h2>
                        <form onSubmit={save} className="mt-3 grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="label" htmlFor="s-plan">Plan</label>
                                <select id="s-plan" className="input" value={form.data.plan_id} onChange={(e) => form.setData('plan_id', Number(e.target.value))}>
                                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (archived)'}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label" htmlFor="s-cycle">Billed</label>
                                <select id="s-cycle" className="input" value={form.data.cycle} onChange={(e) => form.setData('cycle', e.target.value)}>
                                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                                </select>
                            </div>
                            <div>
                                <label className="label" htmlFor="s-status">Status</label>
                                <select id="s-status" className="input" value={form.data.status} onChange={(e) => form.setData('status', e.target.value)}>
                                    {Object.entries(SUB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </div>
                            <div>
                                {form.data.status === 'trialing' ? <>
                                    <label className="label" htmlFor="s-trial">Trial ends</label>
                                    <input id="s-trial" type="date" className="input" value={form.data.trial_ends_at} onChange={(e) => form.setData('trial_ends_at', e.target.value)} />
                                    {form.errors.trial_ends_at && <p className="mt-1 text-sm text-sos">{form.errors.trial_ends_at}</p>}
                                </> : <>
                                    <label className="label" htmlFor="s-end">Paid until</label>
                                    <input id="s-end" type="date" className="input" value={form.data.current_period_end} onChange={(e) => form.setData('current_period_end', e.target.value)} />
                                    {form.errors.current_period_end && <p className="mt-1 text-sm text-sos">{form.errors.current_period_end}</p>}
                                </>}
                            </div>
                            <div>
                                <label className="label" htmlFor="s-cap">Member limit (agreed)</label>
                                <input id="s-cap" inputMode="numeric" className="input" value={form.data.max_members_override} placeholder={`Plan: ${plans.find((p) => p.id === form.data.plan_id)?.max_members?.toLocaleString() ?? 'no limit'}`}
                                    onChange={(e) => form.setData('max_members_override', e.target.value.replace(/\D/g, ''))} />
                            </div>
                            <div>
                                <label className="label" htmlFor="s-price">Price per {form.data.cycle === 'monthly' ? 'month' : 'year'} (agreed, {currency})</label>
                                <input id="s-price" inputMode="decimal" className="input" value={form.data.price_override}
                                    placeholder={`Plan: ${money((() => { const p = plans.find((x) => x.id === form.data.plan_id); return p ? (form.data.cycle === 'monthly' ? p.price_monthly : p.price_yearly) : 0; })(), currency)}`}
                                    onChange={(e) => form.setData('price_override', e.target.value)} />
                            </div>
                            <label className="flex items-center gap-2 text-[15px] sm:col-span-2">
                                <input type="checkbox" className="size-4 accent-leaf" checked={form.data.cancel_at_period_end} onChange={(e) => form.setData('cancel_at_period_end', e.target.checked)} />
                                End the subscription when the current period ends
                            </label>
                            <div className="sm:col-span-2">
                                <label className="label" htmlFor="s-notes">Notes (only the platform team sees these)</label>
                                <textarea id="s-notes" rows={3} className="input" value={form.data.notes} onChange={(e) => form.setData('notes', e.target.value)} placeholder="Agreed 20% discount for 3 years, signed by the Bursar." />
                            </div>
                            <div className="sm:col-span-2"><button className="btn-primary" disabled={form.processing || !form.isDirty}>Save subscription</button></div>
                        </form>
                    </section>

                    <div className="space-y-4">
                        <section className="rounded-2xl bg-white p-5">
                            <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarPlus size={18} className="text-leaf" />Extend the trial</h2>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {[7, 14, 30, 60].map((d) => (
                                    <button key={d} className="btn-outline" onClick={() => router.post(`/platform/institutions/${i.id}/trial`, { days: d }, { preserveScroll: true })}>+{d} days</button>
                                ))}
                            </div>
                        </section>
                        <section className="rounded-2xl bg-white p-5">
                            <h2 className="flex items-center gap-2 text-lg font-bold"><FilePlus2 size={18} className="text-leaf" />Bill this institution</h2>
                            <p className="mt-1 text-sm text-muted">Creates an invoice the school can pay online or by transfer. Paying it activates the plan for the period.</p>
                            <button className="btn-primary mt-3" onClick={() => setNewInvoice(true)}>New invoice</button>
                        </section>
                        <section className="rounded-2xl bg-white p-5 text-[15px]">
                            <h2 className="text-lg font-bold">Details</h2>
                            <dl className="mt-2 space-y-1.5">
                                <Row k="Contact" v={`${i.contact_name}, ${i.contact_email}${i.contact_phone ? `, ${i.contact_phone}` : ''}`} />
                                <Row k="Data protection" v={[i.dpo_name, i.dpo_email].filter(Boolean).join(', ') || 'not given'} />
                                <Row k="Security phone" v={i.security_phone ?? 'not given'} />
                                <Row k="Joined" v={day(i.created_at)} />
                                <Row k="Switched on" v={i.status === 'active' ? day(i.verified_at) : i.status} />
                                <Row k="Accounts" v={`${i.all_users.toLocaleString()} (including parents and admins)`} />
                            </dl>
                            <p className={`mt-2 inline-flex items-center gap-1 text-sm ${i.connector_ok ? 'text-leaf' : 'text-[#8a5a12]'}`}>
                                {i.connector_ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}{i.connector_ok ? 'Records connected' : 'Records not connected'}
                            </p>
                        </section>
                    </div>
                </div>

                <section className="mt-4 rounded-2xl bg-white p-5">
                    <h2 className="flex items-center gap-2 text-lg font-bold"><ReceiptText size={18} className="text-leaf" />Invoices</h2>
                    {invoices.length === 0 && <p className="mt-2 text-muted">No invoices yet.</p>}
                    <ul className="mt-2 divide-y divide-line/70">
                        {invoices.map((v) => (
                            <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{v.number}</span>
                                        <InvoicePill v={v} />
                                    </div>
                                    <p className="text-sm text-muted">{v.description}</p>
                                    <p className="text-sm text-muted">{v.status === 'paid' ? `Paid ${day(v.paid_at)}${v.method_label ? `, ${v.method_label}` : ''}${v.reference ? ` (${v.reference})` : ''}` : v.status === 'open' ? `Due ${day(v.due_at)}` : 'Cancelled'}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <span className="font-bold">{money(v.amount, v.currency)}</span>
                                    {v.status === 'open' && <>
                                        <button className="btn-primary" onClick={() => setPaying(v)}>Mark paid</button>
                                        <button className="btn-ghost text-sos" onClick={() => confirm(`Cancel ${v.number}?`) && router.post(`/platform/invoices/${v.id}/void`, {}, { preserveScroll: true })}>Cancel</button>
                                    </>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>

                {audit.length > 0 && (
                    <section className="mt-4 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">History</h2>
                        <ul className="mt-2 space-y-1.5 text-sm">
                            {audit.map((a) => <li key={a.id} className="flex flex-wrap gap-x-2"><span className="text-muted">{new Date(a.created_at).toLocaleString()}</span><span>{ACTIONS[a.action] ?? a.action}</span></li>)}
                        </ul>
                    </section>
                )}
            </PageBody>

            {paying && <MarkPaid invoice={paying} methods={methods} onClose={() => setPaying(null)} />}
            {newInvoice && <NewInvoice inst={i} sub={s} plans={plans.filter((p) => p.is_active || p.id === s.plan_id)} currency={currency} onClose={() => setNewInvoice(false)} />}
        </AppLayout>
    );
}

const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex flex-col sm:flex-row sm:gap-2"><dt className="shrink-0 text-muted sm:w-36">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
);

export function InvoicePill({ v }: { v: { status: string; overdue: boolean } }) {
    const [label, tone] = v.status === 'paid' ? ['Paid', 'bg-mint text-grove'] : v.status === 'void' ? ['Cancelled', 'bg-line text-muted'] : v.overdue ? ['Overdue', 'bg-sos/10 text-sos'] : ['Unpaid', 'bg-amber/25 text-[#7a4d0b]'];
    return <span className={`pill ${tone}`}>{label}</span>;
}

function MarkPaid({ invoice, methods, onClose }: { invoice: Invoice; methods: Record<string, string>; onClose: () => void }) {
    const form = useForm({ method: 'bank_transfer', reference: '', paid_at: new Date().toISOString().slice(0, 10) });
    return (
        <Modal title={`Record payment for ${invoice.number}`} onClose={onClose}>
            <p className="text-[15px]">{money(invoice.amount, invoice.currency)} · {invoice.description}</p>
            <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); form.post(`/platform/invoices/${invoice.id}/paid`, { preserveScroll: true, onSuccess: onClose }); }}>
                <div>
                    <label className="label" htmlFor="p-method">How it was paid</label>
                    <select id="p-method" className="input" value={form.data.method} onChange={(e) => form.setData('method', e.target.value)}>
                        {Object.entries(methods).filter(([k]) => k !== 'paystack').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="p-ref">Reference</label>
                    <input id="p-ref" className="input" value={form.data.reference} onChange={(e) => form.setData('reference', e.target.value)} placeholder="Bank teller or transfer reference" />
                </div>
                <div>
                    <label className="label" htmlFor="p-date">Date paid</label>
                    <input id="p-date" type="date" className="input" value={form.data.paid_at} onChange={(e) => form.setData('paid_at', e.target.value)} />
                    {form.errors.paid_at && <p className="mt-1 text-sm text-sos">{form.errors.paid_at}</p>}
                </div>
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>Record payment</button></div>
            </form>
        </Modal>
    );
}

function NewInvoice({ inst, sub, plans, currency, onClose }: { inst: Inst; sub: Sub; plans: Plan[]; currency: string; onClose: () => void }) {
    const form = useForm({ plan_id: sub.plan_id, cycle: sub.cycle, amount: '' });
    const plan = plans.find((p) => p.id === form.data.plan_id);
    const listPrice = plan ? (form.data.cycle === 'monthly' ? plan.price_monthly : plan.price_yearly) : 0;
    return (
        <Modal title={`New invoice for ${inst.short_code}`} onClose={onClose}>
            <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault();
                form.transform((d) => ({ ...d, amount: d.amount === '' ? null : toMinor(d.amount) }));
                form.post(`/platform/institutions/${inst.id}/invoices`, { preserveScroll: true, onSuccess: onClose });
            }}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="label" htmlFor="n-plan">Plan</label>
                        <select id="n-plan" className="input" value={form.data.plan_id} onChange={(e) => form.setData('plan_id', Number(e.target.value))}>
                            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="label" htmlFor="n-cycle">Period</label>
                        <select id="n-cycle" className="input" value={form.data.cycle} onChange={(e) => form.setData('cycle', e.target.value)}>
                            <option value="monthly">One month</option><option value="yearly">One year</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className="label" htmlFor="n-amount">Amount ({currency})</label>
                    <input id="n-amount" inputMode="decimal" className="input" value={form.data.amount} onChange={(e) => form.setData('amount', e.target.value)}
                        placeholder={`${money(sub.price_override !== null && form.data.plan_id === sub.plan_id && form.data.cycle === sub.cycle ? sub.price_override : listPrice, currency)} (leave empty for this)`} />
                </div>
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>Create invoice</button></div>
            </form>
        </Modal>
    );
}
