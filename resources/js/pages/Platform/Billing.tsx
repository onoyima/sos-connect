import { Head, useForm } from '@inertiajs/react';
import { CircleAlert, CircleCheck, Copy } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader, Stat } from '@/components/ui';
import { money } from '@/lib/billing';

type Settings = Record<string, unknown>;
type Props = { settings: Settings; plans: { slug: string; name: string }[]; paystack: { configured: boolean; webhook: string };
    stats: { counts: Record<string, number>; monthly_revenue: number; annual_revenue: number; open_invoices: number; open_amount: number; paid_30_days: number; currency: string } };

export default function Billing({ settings: s, plans, paystack, stats }: Props) {
    const g = <T,>(k: string, d: T): T => (s[k] ?? d) as T;
    const form = useForm({
        billing: {
            enforce: g('billing.enforce', false), currency: g('billing.currency', 'NGN'), trial_days: String(g('billing.trial_days', 30)), grace_days: String(g('billing.grace_days', 14)),
            default_plan: g('billing.default_plan', 'standard'), default_cycle: g('billing.default_cycle', 'yearly'), lapse_limits_features: g('billing.lapse_limits_features', true),
            self_service: g('billing.self_service', true), reminder_days: String(g('billing.reminder_days', 7)),
        },
        payments: { online: g('payments.online', false), bank_transfer: g('payments.bank_transfer', true), bank_details: g('payments.bank_details', ''), invoice_due_days: String(g('payments.invoice_due_days', 14)) },
    });
    const b = form.data.billing;
    const p = form.data.payments;
    const setB = (k: keyof typeof b, v: unknown) => form.setData('billing', { ...b, [k]: v });
    const setP = (k: keyof typeof p, v: unknown) => form.setData('payments', { ...p, [k]: v });
    const num = (v: string) => v.replace(/\D/g, '');
    const err = (k: string) => (form.errors as Record<string, string>)[k];

    return (
        <AppLayout title="Billing">
            <Head title="Billing" />
            <PageHeader title="Billing" description="How subscriptions work across SOS Connect: trials, grace periods, what a lapsed institution keeps, and how institutions pay." />
            <PageBody narrow>
                <div className="grid grid-cols-2 gap-3">
                    <Stat label="Monthly revenue" value={money(stats.monthly_revenue, stats.currency)} hint={`${stats.counts.active ?? 0} paying`} />
                    <Stat label="Unpaid" value={money(stats.open_amount, stats.currency)} hint={`${stats.open_invoices} invoice(s)`} />
                </div>
                <form className="mt-4 space-y-4" onSubmit={(e) => {
                    e.preventDefault();
                    form.transform((d) => ({
                        billing: { ...d.billing, trial_days: Number(d.billing.trial_days) || 0, grace_days: Number(d.billing.grace_days) || 0, reminder_days: Number(d.billing.reminder_days) || 0 },
                        payments: { ...d.payments, invoice_due_days: Number(d.payments.invoice_due_days) || 0 },
                    }));
                    form.post('/platform/billing', { preserveScroll: true });
                }}>
                    <section className={`rounded-2xl p-5 ${b.enforce ? 'bg-white' : 'border-2 border-dashed border-line bg-white'}`}>
                        <Toggle checked={b.enforce} onChange={(v) => setB('enforce', v)} title="Enforce subscriptions"
                            text="On: each institution gets only the features in its plan, new members stop at the plan's limit, and unpaid subscriptions lapse after the grace period. Off: everything is tracked (plans, trials, invoices) but nothing is limited." />
                        {b.enforce && <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber/15 px-3 py-2 text-sm"><CircleAlert size={16} className="mt-0.5 shrink-0" />Check every institution's plan and dates under Institutions before saving. SOS is never limited.</p>}
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Trials and renewals</h2>
                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                            <Field id="b-trial" label="Free trial (days)" hint="For new institutions (a plan can set its own)." value={b.trial_days} onChange={(v) => setB('trial_days', num(v))} />
                            <Field id="b-grace" label="Grace period (days)" hint="How long payment can be overdue before features stop." value={b.grace_days} onChange={(v) => setB('grace_days', num(v))} />
                            <Field id="b-remind" label="Remind admins (days before)" hint="Banner for school admins before a trial or period ends." value={b.reminder_days} onChange={(v) => setB('reminder_days', num(v))} />
                            <div>
                                <label className="label" htmlFor="b-cur">Currency</label>
                                <input id="b-cur" className="input uppercase" maxLength={3} value={b.currency} onChange={(e) => setB('currency', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                                <p className="mt-1 text-sm text-muted">Three letters, e.g. NGN, GHS, KES, USD.</p>
                                {err('billing.currency') && <p className="mt-1 text-sm text-sos">{err('billing.currency')}</p>}
                            </div>
                            <div>
                                <label className="label" htmlFor="b-plan">New institutions start on</label>
                                <select id="b-plan" className="input" value={b.default_plan} onChange={(e) => setB('default_plan', e.target.value)}>
                                    {plans.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label" htmlFor="b-cycle">Billed by default</label>
                                <select id="b-cycle" className="input" value={b.default_cycle} onChange={(e) => setB('default_cycle', e.target.value)}>
                                    <option value="yearly">Yearly</option><option value="monthly">Monthly</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Institutions</h2>
                        <Toggle checked={b.lapse_limits_features} onChange={(v) => setB('lapse_limits_features', v)} title="Lapsed institutions lose features"
                            text="After the grace period, only SOS, notices, safety checks and offline SOS keep working until they pay. Off: a lapsed institution keeps its plan's features (useful while you chase payment by hand)." />
                        <Toggle checked={b.self_service} onChange={(v) => setB('self_service', v)} title="Schools choose their own plan"
                            text="School admins pick a plan on their Subscription page and get an invoice to pay. Off: their choice is sent to you in the platform chat and you set it." />
                    </section>

                    <section className="space-y-4 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Payments</h2>
                        <Toggle checked={p.online} onChange={(v) => setP('online', v)} title="Online payment (Paystack)"
                            text="Card, bank and USSD payments. Paid invoices activate the subscription automatically." />
                        <div className={`rounded-xl px-3 py-2.5 text-sm ${paystack.configured ? 'bg-mint/60' : 'bg-amber/15'}`}>
                            <p className="flex items-center gap-1.5 font-medium">{paystack.configured ? <><CircleCheck size={16} className="text-leaf" />Paystack keys are set on the server.</> : <><CircleAlert size={16} />Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY to the server's .env, then run php artisan config:cache.</>}</p>
                            <p className="mt-1">In your Paystack dashboard (Settings → API keys and webhooks), set the webhook URL to:</p>
                            <p className="mt-1 flex items-center gap-2"><code className="min-w-0 rounded bg-white px-2 py-1 break-all">{paystack.webhook}</code>
                                <button type="button" className="btn-ghost shrink-0 px-2" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(paystack.webhook)}><Copy size={16} /></button></p>
                            {err('payments.online') && <p className="mt-1 text-sos">{err('payments.online')}</p>}
                        </div>
                        <Toggle checked={p.bank_transfer} onChange={(v) => setP('bank_transfer', v)} title="Bank transfer" text="Schools see your bank details on their invoices; you record the payment when it arrives." />
                        {p.bank_transfer && (
                            <div>
                                <label className="label" htmlFor="p-bank">Bank details shown to schools</label>
                                <textarea id="p-bank" rows={4} className="input" value={p.bank_details} onChange={(e) => setP('bank_details', e.target.value)}
                                    placeholder={'Bank: …\nAccount name: …\nAccount number: …\nUse the invoice number as the payment reference.'} />
                            </div>
                        )}
                        <Field id="p-due" label="Invoices are due after (days)" value={p.invoice_due_days} onChange={(v) => setP('invoice_due_days', num(v))} />
                    </section>

                    <div className="sticky bottom-0 flex justify-end bg-mist/90 py-3 backdrop-blur">
                        <button className="btn-primary px-6 py-3" disabled={form.processing || !form.isDirty}>Save billing settings</button>
                    </div>
                </form>
            </PageBody>
        </AppLayout>
    );
}

function Toggle({ checked, onChange, title, text }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
    return (
        <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1"><div className="font-semibold">{title}</div><div className="text-sm text-muted">{text}</div></div>
            <button type="button" role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}
                className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-leaf' : 'bg-line'}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
        </div>
    );
}

function Field({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="label" htmlFor={id}>{label}</label>
            <input id={id} inputMode="numeric" className="input" value={value} onChange={(e) => onChange(e.target.value)} />
            {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
        </div>
    );
}
