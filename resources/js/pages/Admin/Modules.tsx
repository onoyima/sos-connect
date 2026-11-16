import { Head, useForm } from '@inertiajs/react';
import { Lock, Siren } from 'lucide-react';
import { Link } from '@inertiajs/react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';

type Mod = { key: string; label: string; description: string; requires: string | null; saved: boolean; enabled: boolean; in_plan?: boolean };

export default function Modules({ modules }: { modules: Mod[] }) {
    const form = useForm<{ modules: Record<string, boolean> }>({ modules: Object.fromEntries(modules.map((m) => [m.key, m.saved])) });
    const label = (k: string | null) => modules.find((m) => m.key === k)?.label ?? k;
    const set = (k: string, v: boolean) => form.setData('modules', { ...form.data.modules, [k]: v });
    const changed = modules.some((m) => form.data.modules[m.key] !== m.saved);

    return (
        <AppLayout title="Features">
            <Head title="Features" />
            <PageHeader title="Features" description="Switch parts of SOS Connect on or off for everyone in your institution. Switching off hides a feature straight away; nothing is deleted, so it comes back as it was when you switch it on." />
            <PageBody narrow>
                <div className="mb-4 flex items-start gap-3 rounded-2xl bg-white p-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sos text-white"><Siren size={20} /></span>
                    <p className="text-[15px]"><strong>SOS is always on.</strong> It can't be switched off, online or offline, because it may be the only way someone can get help.</p>
                </div>
                <div className="overflow-hidden rounded-2xl bg-white">
                    {modules.map((m) => {
                        const on = !!form.data.modules[m.key];
                        const parentOff = m.requires ? !form.data.modules[m.requires] : false;
                        if (m.in_plan === false) {
                            return (
                                <div key={m.key} className={`flex items-start gap-4 border-b border-line/70 px-4 py-3.5 last:border-0 ${m.requires ? 'pl-10' : ''}`}>
                                    <div className="min-w-0 flex-1 opacity-60">
                                        <div className="font-semibold">{m.label}</div>
                                        <div className="text-sm text-muted">{m.description}</div>
                                    </div>
                                    <Link href="/admin/subscription" className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-grove hover:bg-mint">
                                        <Lock size={12} />Not in your plan
                                    </Link>
                                </div>
                            );
                        }
                        return (
                            <label key={m.key} className={`flex cursor-pointer items-start gap-4 border-b border-line/70 px-4 py-3.5 last:border-0 ${parentOff ? 'opacity-50' : ''} ${m.requires ? 'pl-10' : ''}`}>
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold">{m.label}</div>
                                    <div className="text-sm text-muted">{m.description}{parentOff && ` Needs "${label(m.requires)}" on.`}</div>
                                </div>
                                <button type="button" role="switch" aria-checked={on} aria-label={m.label} onClick={() => set(m.key, !on)}
                                    className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-leaf' : 'bg-line'}`}>
                                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                                </button>
                            </label>
                        );
                    })}
                </div>
                <div className="sticky bottom-0 flex justify-end bg-mist/90 py-3 backdrop-blur">
                    <button className="btn-primary px-6 py-3" disabled={!changed || form.processing} onClick={() => form.post('/admin/modules', { preserveScroll: true })}>Save changes</button>
                </div>
            </PageBody>
        </AppLayout>
    );
}
