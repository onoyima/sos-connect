import { Head } from '@inertiajs/react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, PageBody, PageHeader } from '@/components/ui';
import { Pager } from '@/components/ui';
import { ScrollText } from 'lucide-react';

type Entry = { id: number; actor_id: number | null; actor_name: string | null; action: string; target_type: string | null; target_id: number | null; meta: Record<string, unknown> | null; ip_address: string | null; created_at: string };

const human = (a: string) => a.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const stamp = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const who = (e: Entry) => (e.actor_id ? (e.actor_name ?? `Member #${e.actor_id}`) : 'System');
const target = (e: Entry) => `${e.target_type!.split('\\').pop()} #${e.target_id}`;

function Meta({ meta }: { meta: Record<string, unknown> }) {
    return (
        <div className="mt-1.5 space-y-0.5 text-xs break-words text-muted">
            {Object.entries(meta).map(([k, v]) => <div key={k}><span className="font-medium text-ink">{k.replace(/_/g, ' ')}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>)}
        </div>
    );
}

type Links = { url: string | null; label: string; active: boolean }[];

export default function Audit({ entries, links, page }: { entries: Entry[]; links: Links; page: { current: number; last: number; total: number } }) {
    return (
        <AppLayout title="Audit log">
            <Head title="Audit log" />
            <PageHeader title="Audit log" description={`Every admin action, sign-in change and policy acceptance, kept for accountability. Entries can't be edited.${page.total ? ` ${page.total} entries, page ${page.current} of ${page.last}.` : ''}`} />
            <PageBody>
                {entries.length === 0 ? <EmptyState icon={<ScrollText size={26} />} title="Nothing recorded yet" /> : (<>
                    {/* Phones: one card per entry, so nothing scrolls sideways. */}
                    <ul className="space-y-2 md:hidden">
                        {entries.map((e) => (
                            <li key={e.id} className="rounded-2xl bg-white p-4 text-sm">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-semibold">{human(e.action)}</span>
                                    <span className="shrink-0 text-xs text-muted">{stamp(e.created_at)}</span>
                                </div>
                                <div className="mt-0.5 text-muted">{who(e)}{e.target_type ? `, ${target(e)}` : ''}</div>
                                {e.meta && <Meta meta={e.meta} />}
                            </li>
                        ))}
                    </ul>
                    <div className="hidden overflow-hidden rounded-2xl bg-white md:block">
                        <table className="w-full table-fixed text-sm">
                            <thead className="border-b border-line text-left text-muted">
                                <tr><th className="w-32 px-4 py-3 font-medium">When</th><th className="w-[18%] px-4 py-3 font-medium">Who</th><th className="w-[20%] px-4 py-3 font-medium">What</th><th className="w-[16%] px-4 py-3 font-medium">Affected</th><th className="px-4 py-3 font-medium">Details</th></tr>
                            </thead>
                            <tbody>
                                {entries.map((e) => (
                                    <tr key={e.id} className="border-b border-line/60 align-top last:border-0">
                                        <td className="px-4 py-3 text-muted">{stamp(e.created_at)}</td>
                                        <td className="px-4 py-3 break-words">{who(e)}</td>
                                        <td className="px-4 py-3 font-medium break-words">{human(e.action)}</td>
                                        <td className="px-4 py-3 break-words text-muted">{e.target_type ? target(e) : ''}</td>
                                        <td className="px-4 py-3">{e.meta && <Meta meta={e.meta} />}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>)}
                <Pager links={links} />
            </PageBody>
        </AppLayout>
    );
}
