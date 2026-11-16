import { Head, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { Check, Package, Plus, Siren } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, Modal, PageBody, PageHeader } from '@/components/ui';
import { fromMinor, money, toMinor } from '@/lib/billing';

type Plan = { id: number; slug: string; name: string; description: string | null; price_monthly: number; price_yearly: number; max_members: number | null;
    modules: string[]; trial_days: number | null; is_public: boolean; is_active: boolean; position: number; subscriptions_count: number };
type Mod = { key: string; label: string; requires: string | null };

export default function Plans({ plans, modules, currency }: { plans: Plan[]; modules: Mod[]; currency: string }) {
    const [editing, setEditing] = useState<Plan | 'new' | null>(null);
    const label = (k: string) => modules.find((m) => m.key === k)?.label ?? k;

    return (
        <AppLayout title="Plans">
            <Head title="Plans" />
            <PageHeader title="Plans" description="The packages institutions subscribe to: which features they get, how many members, and the price. SOS is in every plan and always works."
                actions={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={18} />New plan</button>} />
            <PageBody>
                {plans.length === 0 && <EmptyState icon={<Package size={26} />} title="No plans yet" />}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {plans.map((p) => (
                        <article key={p.id} className={`flex min-w-0 flex-col rounded-2xl bg-white p-5 ${p.is_active ? '' : 'opacity-60'}`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-bold">{p.name}</h2>
                                {!p.is_public && <span className="pill bg-mist text-muted">hidden from schools</span>}
                                {!p.is_active && <span className="pill bg-line text-muted">archived</span>}
                            </div>
                            {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                            <p className="mt-3 text-2xl font-bold text-grove">{money(p.price_yearly, currency)}<span className="text-sm font-normal text-muted"> a year</span></p>
                            <p className="text-sm text-muted">or {money(p.price_monthly, currency)} a month</p>
                            <p className="mt-2 text-[15px]">{p.max_members ? `Up to ${p.max_members.toLocaleString()} members` : 'No member limit'}{p.trial_days !== null ? ` · ${p.trial_days}-day trial` : ''}</p>
                            <ul className="mt-3 flex-1 space-y-1 text-sm">
                                <li className="flex items-center gap-2 font-medium text-sos"><Siren size={14} />SOS (always included)</li>
                                {p.modules.filter((m) => !modules.find((x) => x.key === m)?.requires).map((m) => <li key={m} className="flex items-center gap-2"><Check size={14} className="text-leaf" />{label(m)}</li>)}
                                {p.modules.some((m) => modules.find((x) => x.key === m)?.requires) && <li className="pl-6 text-muted">+ {p.modules.filter((m) => modules.find((x) => x.key === m)?.requires).length} more options</li>}
                            </ul>
                            <div className="mt-4 flex items-center justify-between gap-2">
                                <span className="text-sm text-muted">{p.subscriptions_count} institution{p.subscriptions_count === 1 ? '' : 's'}</span>
                                <button className="btn-outline" onClick={() => setEditing(p)}>Edit</button>
                            </div>
                        </article>
                    ))}
                </div>
            </PageBody>
            {editing && <PlanEditor plan={editing === 'new' ? null : editing} modules={modules} currency={currency} onClose={() => setEditing(null)} />}
        </AppLayout>
    );
}

function PlanEditor({ plan, modules, currency, onClose }: { plan: Plan | null; modules: Mod[]; currency: string; onClose: () => void }) {
    const form = useForm({
        name: plan?.name ?? '', description: plan?.description ?? '', price_monthly: fromMinor(plan?.price_monthly ?? 0), price_yearly: fromMinor(plan?.price_yearly ?? 0),
        max_members: plan?.max_members ? String(plan.max_members) : '', trial_days: plan?.trial_days !== null && plan?.trial_days !== undefined ? String(plan.trial_days) : '',
        modules: plan?.modules ?? modules.map((m) => m.key), is_public: plan?.is_public ?? true, is_active: plan?.is_active ?? true, position: String(plan?.position ?? 100),
    });
    const toggle = (k: string, on: boolean) => {
        let next = new Set(form.data.modules);
        if (on) {
            for (let r: string | null = k; r; r = modules.find((m) => m.key === r)?.requires ?? null) next.add(r); // bring what it needs
        } else {
            next.delete(k);
            // and drop what needs it
            let changed = true;
            while (changed) { changed = false; for (const m of modules) if (m.requires && !next.has(m.requires) && next.has(m.key)) { next.delete(m.key); changed = true; } }
        }
        form.setData('modules', [...next]);
    };
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.transform((d) => ({ ...d, price_monthly: toMinor(d.price_monthly), price_yearly: toMinor(d.price_yearly),
            max_members: d.max_members ? Number(d.max_members) : null, trial_days: d.trial_days === '' ? null : Number(d.trial_days), position: Number(d.position) || 100 }));
        form.post(plan ? `/platform/plans/${plan.id}` : '/platform/plans', { preserveScroll: true, onSuccess: onClose });
    };
    return (
        <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose} wide>
            <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="pl-name">Name</label>
                        <input id="pl-name" className="input" value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} required />
                        {form.errors.name && <p className="mt-1 text-sm text-sos">{form.errors.name}</p>}
                    </div>
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="pl-desc">Short description (schools see this)</label>
                        <input id="pl-desc" className="input" value={form.data.description} onChange={(e) => form.setData('description', e.target.value)} />
                    </div>
                    <div>
                        <label className="label" htmlFor="pl-m">Price per month ({currency})</label>
                        <input id="pl-m" inputMode="decimal" className="input" value={form.data.price_monthly} onChange={(e) => form.setData('price_monthly', e.target.value)} />
                    </div>
                    <div>
                        <label className="label" htmlFor="pl-y">Price per year ({currency})</label>
                        <input id="pl-y" inputMode="decimal" className="input" value={form.data.price_yearly} onChange={(e) => form.setData('price_yearly', e.target.value)} />
                    </div>
                    <div>
                        <label className="label" htmlFor="pl-cap">Member limit (students and staff)</label>
                        <input id="pl-cap" inputMode="numeric" className="input" value={form.data.max_members} placeholder="Empty = no limit" onChange={(e) => form.setData('max_members', e.target.value.replace(/\D/g, ''))} />
                    </div>
                    <div>
                        <label className="label" htmlFor="pl-trial">Trial days</label>
                        <input id="pl-trial" inputMode="numeric" className="input" value={form.data.trial_days} placeholder="Empty = the platform default" onChange={(e) => form.setData('trial_days', e.target.value.replace(/\D/g, ''))} />
                    </div>
                </div>
                <fieldset>
                    <legend className="label">Features in this plan</legend>
                    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                        {modules.map((m) => (
                            <label key={m.key} className={`flex items-center gap-2 text-[15px] ${m.requires ? 'pl-5' : ''}`}>
                                <input type="checkbox" className="size-4 shrink-0 accent-leaf" checked={form.data.modules.includes(m.key)} onChange={(e) => toggle(m.key, e.target.checked)} />
                                <span className="min-w-0">{m.label}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
                    <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-leaf" checked={form.data.is_public} onChange={(e) => form.setData('is_public', e.target.checked)} />Schools can see and choose it</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-leaf" checked={form.data.is_active} onChange={(e) => form.setData('is_active', e.target.checked)} />Available (untick to archive)</label>
                    <label className="flex items-center gap-2">Order <input inputMode="numeric" className="input w-20" value={form.data.position} onChange={(e) => form.setData('position', e.target.value.replace(/\D/g, ''))} /></label>
                </div>
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>Save plan</button></div>
            </form>
        </Modal>
    );
}
