import { Head } from '@inertiajs/react';
import { Flag, Inbox } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';

type Report = { id: number; target_type: string; target_id: number; reason: string; status: string; created_at: string };
type DataRequest = { id: number; type: string; status: string; details: string | null; due_at: string; user: { name: string; identifier: string | null } | null };

const REQUEST: Record<string, string> = { rectification: 'Correct data', erasure: 'Erase data', restriction: 'Limit use', objection: 'Objection', access: 'Copy of data' };

export default function Reports({ reports, dataRequests }: { reports: Report[]; dataRequests: DataRequest[] }) {
    return (
        <AppLayout title="Reports and requests">
            <Head title="Reports and requests" />
            <PageHeader title="Reports and requests" description="Messages members have reported, and requests about personal data. Data requests must be answered by the date shown." />
            <PageBody>
                <div className="grid gap-4 lg:grid-cols-2">
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><Flag size={19} className="text-sos" />Reported messages</h2>
                        {reports.length === 0 ? <p className="mt-3 text-sm text-muted">No reports. Members can report a message from the chat.</p> : (
                            <ul className="mt-3 divide-y divide-line">
                                {reports.map((r) => (
                                    <li key={r.id} className="py-3">
                                        <div className="flex items-center justify-between gap-2 text-sm">
                                            <span className="font-semibold">{r.target_type} #{r.target_id}</span>
                                            <span className={`pill ${r.status === 'open' ? 'bg-amber/25 text-[#7a4d0b]' : 'bg-mint text-grove'}`}>{r.status}</span>
                                        </div>
                                        <p className="mt-1 text-[15px]">{r.reason}</p>
                                        <p className="mt-0.5 text-xs text-muted">{new Date(r.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><Inbox size={19} className="text-leaf" />Data requests</h2>
                        <p className="mt-1 text-sm text-muted">Your institution decides these. Pass each one to your data protection officer.</p>
                        {dataRequests.length === 0 ? <p className="mt-3 text-sm text-muted">No requests.</p> : (
                            <ul className="mt-3 divide-y divide-line">
                                {dataRequests.map((d) => {
                                    const late = new Date(d.due_at) < new Date() && d.status !== 'completed';
                                    return (
                                        <li key={d.id} className="py-3">
                                            <div className="flex items-center justify-between gap-2 text-sm">
                                                <span className="font-semibold">{d.user?.name ?? 'Former member'}{d.user?.identifier && <span className="font-normal text-muted">, {d.user.identifier}</span>}</span>
                                                <span className="pill bg-mist text-ink">{REQUEST[d.type] ?? d.type}</span>
                                            </div>
                                            {d.details && <p className="mt-1 text-[15px]">{d.details}</p>}
                                            <p className={`mt-0.5 text-xs ${late ? 'font-semibold text-sos' : 'text-muted'}`}>{d.status}, answer by {new Date(d.due_at).toLocaleDateString([], { day: 'numeric', month: 'long' })}{late && ' (overdue)'}</p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>
            </PageBody>
        </AppLayout>
    );
}
