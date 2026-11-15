import { Head, router, useForm } from '@inertiajs/react';
import { ImageUp, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { BrandMark, Mark } from '@/components/AuthShell';
import { PageBody, PageHeader } from '@/components/ui';
import type { Branding as BrandingInfo } from '@/types';

type Season = { key: string; label: string; badge: string; accent: string; next: string | null };
type Props = { settings: { favicon: string | null; icon: string | null; seasonal: boolean; seasons: string[] }; current: BrandingInfo; seasons: Season[] };

/** Admin > Look and icons: favicon, chat icon and seasonal touches. */
export default function Branding({ settings, current, seasons }: Props) {
    const form = useForm<{ seasonal: boolean; seasons: string[] }>({ seasonal: settings.seasonal, seasons: settings.seasons });
    const upload = (kind: 'favicon' | 'icon', file: File | undefined) => {
        if (!file) return;
        router.post('/admin/branding', { [kind]: file }, { forceFormData: true, preserveScroll: true });
    };
    const remove = (kind: 'favicon' | 'icon') => router.post('/admin/branding', { remove: kind }, { preserveScroll: true });
    const toggle = (key: string) => form.setData('seasons', form.data.seasons.includes(key) ? form.data.seasons.filter((k) => k !== key) : [...form.data.seasons, key]);

    return (
        <AppLayout title="Look and icons">
            <Head title="Look and icons" />
            <PageHeader title="Look and icons" description="Your institution's icon in the app and in the browser tab, and a small seasonal touch around celebrations." />
            <PageBody narrow>
                <div className="grid gap-4 sm:grid-cols-2">
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="font-semibold">Chat icon</h2>
                        <p className="mt-1 text-sm text-muted">Shown at the top of the app and on the sign-in page. Square PNG, JPG or WebP, at least 96×96.</p>
                        <div className="mt-4 flex items-center gap-4">
                            {current.icon ? <img src={current.icon} alt="Chat icon" className="size-16 rounded-[30%] object-cover" /> : <Mark size={64} />}
                            <div className="flex flex-col gap-2">
                                <label className="btn-outline cursor-pointer"><ImageUp size={16} />Upload<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload('icon', e.target.files?.[0])} /></label>
                                {settings.icon && <button className="btn-ghost text-sos" onClick={() => remove('icon')}><Trash2 size={15} />Use the built-in icon</button>}
                            </div>
                        </div>
                    </section>
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="font-semibold">Favicon</h2>
                        <p className="mt-1 text-sm text-muted">The small icon in the browser tab. ICO or PNG (32×32 or 64×64). If you don't set one, the chat icon is used.</p>
                        <div className="mt-4 flex items-center gap-4">
                            <img src={current.favicon ?? current.icon ?? '/favicon.ico'} alt="Favicon" className="size-8 rounded" />
                            <div className="flex flex-col gap-2">
                                <label className="btn-outline cursor-pointer"><ImageUp size={16} />Upload<input type="file" accept="image/png,image/x-icon,image/vnd.microsoft.icon,.ico" className="hidden" onChange={(e) => upload('favicon', e.target.files?.[0])} /></label>
                                {settings.favicon && <button className="btn-ghost text-sos" onClick={() => remove('favicon')}><Trash2 size={15} />Remove</button>}
                            </div>
                        </div>
                    </section>
                </div>

                <section className="mt-4 rounded-2xl bg-white p-5">
                    <div className="flex flex-wrap items-center gap-4">
                        <BrandMark size={56} />
                        <div className="min-w-0 flex-1">
                            <h2 className="font-semibold">Seasonal icons</h2>
                            <p className="text-sm text-muted">{current.season ? `Showing now: ${current.season.label} ${current.season.badge}` : 'Nothing is being celebrated today.'} The badge is added to the chat icon and the favicon automatically, and removed afterwards.</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <input type="checkbox" className="size-5 accent-[#1e7b57]" checked={form.data.seasonal} onChange={(e) => form.setData('seasonal', e.target.checked)} />Switched on
                        </label>
                    </div>
                    <div className={`mt-4 grid gap-2 sm:grid-cols-2 ${form.data.seasonal ? '' : 'pointer-events-none opacity-50'}`}>
                        {seasons.map((s) => (
                            <label key={s.key} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                                <input type="checkbox" className="size-4 accent-[#1e7b57]" checked={form.data.seasons.includes(s.key)} onChange={() => toggle(s.key)} />
                                <span className="text-xl" aria-hidden>{s.badge}</span>
                                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{s.label}</span>
                                    <span className="block text-xs text-muted">{s.next ? `Next: ${new Date(s.next).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not in the next year for your country'}</span></span>
                            </label>
                        ))}
                    </div>
                    <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={form.processing} onClick={() => form.post('/admin/branding', { preserveScroll: true })}>Save</button></div>
                </section>
            </PageBody>
        </AppLayout>
    );
}
