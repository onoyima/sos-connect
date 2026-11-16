import { Head, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { Check, CircleAlert, CreditCard, Landmark, Siren } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Modal, PageBody, PageHeader, Stat } from '@/components/ui';
import { day, money, SUB_STATUS } from '@/lib/billing';
import { InvoicePill } from '@/pages/Platform/InstitutionShow';

type Plan = { id: number; name: string; description: string | null; price_monthly: number; price_yearly: number; max_members: number | null; modules: string[] };
type Invoice = { id: number; number: string; description: string; amount: number; currency: string; status: string; due_at: string | null; paid_at: string | null; method_label: string | null; reference: string | null; overdue: boolean };
type Props = {
    subscription: { status: string; cycle: string; plan_id: number; plan: string | null; member_limit: number | null; price: number; cancel_at_period_end: boolean;
        trial_ends_at: string | null; current_period_end: string | null; days_left: number | null; grace_ends_at: string | null };
    summary: { enforced: boolean } | null; members: number; plans: Plan[]; features: Record<string, string>; invoices: Invoice[];
    payments: { online: boolean; bank_transfer: boolean; bank_details: string; self_service: boolean }; currency: string;
};

export default function Subscription({ subscription: s, summary, members, plans, features, invoices, payments, currency }: Props) {
    const [cycle, setCycle] = useState<'monthly' | 'yearly'>(s.cycle === 'monthly' ? 'monthly' : 'yearly');
    const [choosing, setChoosing] = useState<Plan | null>(null);
    const st = SUB_STATUS[s.status];
    const open = invoices.filter((v) => v.status === 'open');
    const usage = s.member_limit ? Math.min(100, Math.round((members / s.member_limit) * 100)) : null;

    return (
        <AppLayout title="Subscription">
            <Head title="Subscription" />
            <PageHeader title="Subscription" description="Your SOS Connect plan, what it includes, and your invoices. SOS is included in every plan and always works, whatever happens to the subscription." />
            <PageBody>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Your plan" value={s.plan ?? '—'} hint={st?.label} />
                    <Stat label={s.status === 'trialing' ? 'Trial ends' : s.cancel_at_period_end ? 'Ends on' : 'Renews on'} value={day(s.status === 'trialing' ? s.trial_ends_at : s.current_period_end)}
                        hint={s.days_left !== null ? `${s.days_left} day${s.days_left === 1 ? '' : 's'} left` : undefined} />
                    <Stat label="Members" value={members.toLocaleString()} hint={s.member_limit ? `of ${s.member_limit.toLocaleString()} in your plan` : 'no limit'} />
                    <Stat label="To pay" value={money(open.reduce((a, v) => a + v.amount, 0), currency)} hint={`${open.length} invoice(s)`} />
                </div>
                {usage !== null && usage >= 80 && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber/20 px-3 py-2 text-sm"><CircleAlert size={16} className="mt-0.5 shrink-0" />
                        You're using {usage}% of your plan's members. {usage >= 100 ? "New students and staff can't sign in until you move to a bigger plan." : 'Consider a bigger plan before you reach the limit.'}</p>
                )}
                {s.status === 'past_due' && <p className="mt-3 flex items-start gap-2 rounded-xl bg-sos/10 px-3 py-2 text-sm"><CircleAlert size={16} className="mt-0.5 shrink-0 text-sos" />Payment is due.{s.grace_ends_at ? ` Features stop on ${day(s.grace_ends_at)} if it isn't paid.` : ''} SOS keeps working.</p>}
                {summary && !summary.enforced && <p className="mt-3 text-sm text-muted">During this introductory period every feature stays on, whatever your plan.</p>}

                {open.length > 0 && (
                    <section className="mt-5 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">To pay</h2>
                        <ul className="mt-2 divide-y divide-line/70">
                            {open.map((v) => (
                                <li key={v.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{v.number}</span><InvoicePill v={v} /></div>
                                        <p className="text-sm text-muted">{v.description} · due {day(v.due_at)}</p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        <span className="text-lg font-bold">{money(v.amount, v.currency)}</span>
                                        {payments.online && <button className="btn-primary" onClick={() => router.post(`/admin/invoices/${v.id}/pay`)}><CreditCard size={16} />Pay online</button>}
                                    </div>
                                </li>
                            ))}
                        </ul>
                        {payments.bank_transfer && payments.bank_details && (
                            <div className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm">
                                <p className="flex items-center gap-1.5 font-semibold"><Landmark size={16} />Pay by bank transfer</p>
                                <p className="mt-1 whitespace-pre-wrap">{payments.bank_details}</p>
                                <p className="mt-1 text-muted">Use the invoice number as the reference. The SOS Connect team records it when it arrives.</p>
                            </div>
                        )}
                        {!payments.online && !(payments.bank_transfer && payments.bank_details) && <p className="mt-2 text-sm text-muted">The SOS Connect team will tell you how to pay. Ask them in the platform chat.</p>}
                    </section>
                )}

                <section className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-bold">Plans</h2>
                        <div className="flex rounded-full bg-white p-1 text-sm font-medium" role="group" aria-label="Billing period">
                            {(['yearly', 'monthly'] as const).map((c) => (
                                <button key={c} onClick={() => setCycle(c)} className={`rounded-full px-3 py-1.5 ${cycle === c ? 'bg-grove text-white' : 'text-ink'}`}>{c === 'yearly' ? 'Yearly' : 'Monthly'}</button>
                            ))}
                        </div>
                    </div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {plans.map((p) => {
                            const current = p.id === s.plan_id;
                            return (
                                <article key={p.id} className={`flex min-w-0 flex-col rounded-2xl bg-white p-5 ${current ? 'ring-2 ring-leaf' : ''}`}>
                                    <div className="flex items-center gap-2"><h3 className="text-xl font-bold">{p.name}</h3>{current && <span className="pill bg-mint text-grove">your plan</span>}</div>
                                    {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                                    <p className="mt-3 text-2xl font-bold text-grove">{money(cycle === 'monthly' ? p.price_monthly : p.price_yearly, currency)}<span className="text-sm font-normal text-muted"> / {cycle === 'monthly' ? 'month' : 'year'}</span></p>
                                    <p className="mt-1 text-[15px]">{p.max_members ? `Up to ${p.max_members.toLocaleString()} students and staff` : 'Any number of students and staff'}</p>
                                    <ul className="mt-3 flex-1 space-y-1 text-sm">
                                        <li className="flex items-center gap-2 font-medium text-sos"><Siren size={14} />SOS, always</li>
                                        {p.modules.map((m) => features[m] && <li key={m} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-leaf" />{features[m]}</li>)}
                                    </ul>
                                    {!(current && cycle === s.cycle && s.status === 'active') && (
                                        <button className={`${current ? 'btn-outline' : 'btn-primary'} mt-4`} onClick={() => setChoosing(p)}>
                                            {current ? (s.status === 'active' ? 'Switch billing period' : 'Pay for this plan') : `Choose ${p.name}`}
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-5 rounded-2xl bg-white p-5">
                    <h2 className="text-lg font-bold">Invoices</h2>
                    {invoices.length === 0 ? <p className="mt-2 text-muted">No invoices yet.</p> : (
                        <ul className="mt-2 divide-y divide-line/70">
                            {invoices.map((v) => (
                                <li key={v.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                                    <span className="font-semibold sm:w-36">{v.number}</span>
                                    <span className="min-w-0 flex-1 text-sm text-muted">{v.description}</span>
                                    <span className="flex items-center gap-2"><InvoicePill v={v} /><span className="font-semibold">{money(v.amount, v.currency)}</span></span>
                                    {v.status === 'paid' && <span className="text-sm text-muted">paid {day(v.paid_at)}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {(s.status === 'active' || s.status === 'trialing') && (
                    <section className="mt-5 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">{s.cancel_at_period_end ? 'Your subscription is set to end' : 'End your subscription'}</h2>
                        <p className="mt-1 text-sm text-muted">{s.cancel_at_period_end
                            ? `It ends on ${day(s.status === 'trialing' ? s.trial_ends_at : s.current_period_end)}. Until then everything works as now.`
                            : 'It carries on until the end of the period you have paid for (or your trial), then stops. SOS keeps working.'}</p>
                        <button className={`mt-3 ${s.cancel_at_period_end ? 'btn-primary' : 'btn-outline text-sos'}`}
                            onClick={() => (s.cancel_at_period_end || confirm('End the subscription at the end of this period?')) && router.post('/admin/subscription/cancel', { cancel: !s.cancel_at_period_end }, { preserveScroll: true })}>
                            {s.cancel_at_period_end ? 'Keep my subscription' : 'End at the end of this period'}
                        </button>
                    </section>
                )}
            </PageBody>

            {choosing && <Choose plan={choosing} cycle={cycle} currency={currency} selfService={payments.self_service} onClose={() => setChoosing(null)} />}
        </AppLayout>
    );
}

function Choose({ plan, cycle, currency, selfService, onClose }: { plan: Plan; cycle: 'monthly' | 'yearly'; currency: string; selfService: boolean; onClose: () => void }) {
    const form = useForm({ plan_id: plan.id, cycle, message: '' });
    const price = cycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
    return (
        <Modal title={`${plan.name}, ${cycle === 'monthly' ? 'monthly' : 'yearly'}`} onClose={onClose}>
            <p className="text-[15px]">{money(price, currency)} per {cycle === 'monthly' ? 'month' : 'year'}.</p>
            <p className="mt-2 text-sm text-muted">{selfService
                ? price === 0 ? 'This plan is free: it starts straight away.' : "We'll make an invoice. The new plan starts when it's paid (any time you've already paid for carries on)."
                : 'Your request goes to the SOS Connect team, who will set it up and reply in the platform chat.'}</p>
            {!selfService && (
                <div className="mt-3">
                    <label className="label" htmlFor="c-msg">Anything to add? (optional)</label>
                    <textarea id="c-msg" rows={3} className="input" value={form.data.message} onChange={(e) => form.setData('message', e.target.value)} />
                </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-primary" disabled={form.processing} onClick={() => form.post('/admin/subscription/plan', { preserveScroll: true, onSuccess: onClose })}>
                    {selfService ? (price === 0 ? 'Switch plan' : 'Create invoice') : 'Send request'}
                </button>
            </div>
        </Modal>
    );
}
