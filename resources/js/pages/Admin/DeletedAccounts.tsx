import { Head, Link, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { ChevronDown, Download, RotateCcw, Search, UserX } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, Modal, PageBody, PageHeader, Stat } from '@/components/ui';

type Snapshot = { name?: string; identifier?: string | null; email?: string | null; phone?: string | null; member_type?: string; title?: string | null; level?: number | null;
    programme?: string | null; faculty?: string | null; department?: string | null; admin_unit?: string | null; residence?: string | null; joined_at?: string | null; last_seen_at?: string | null };
type Rec = { id: number; user_id: number | null; status: 'closed' | 'restored'; source: string; reason: string | null; requested_at: string; previous_status: string | null; snapshot: Snapshot;
    ip_address: string | null; user_agent: string | null; closed_by: string | null; restored_by: string | null; restored_at: string | null; restore_note: string | null;
    current_status: string | null; counts: { messages: number; groups: number; sos: number } };
type Page<T> = { data: T[]; links: { url: string | null; label: string; active: boolean }[]; total: number };
type Props = { records: Page<Rec>; totals: { closed: number; restored: number; last_30_days: number }; filters: { q?: string; status?: string; type?: string }; can: { restore: boolean } };

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const SOURCE: Record<string, string> = { web: 'Website', app: 'Phone app', admin: 'An admin' };
const TYPE: Record<string, string> = { student: 'Student', staff: 'Staff', parent: 'Parent', alumni: 'Alumni', admin: 'Admin' };

export default function DeletedAccounts({ records, totals, filters, can }: Props) {
    const [q, setQ] = useState(filters.q ?? '');
    const [open, setOpen] = useState<number | null>(null);
    const [restoring, setRestoring] = useState<Rec | null>(null);
    const go = (next: Partial<Props['filters']>) => router.get('/admin/deleted-accounts', { ...filters, ...next }, { preserveState: true, preserveScroll: true, replace: true });
    const exportUrl = `/admin/deleted-accounts/export?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString()}`;

    return (
        <AppLayout title="Deleted accounts">
            <Head title="Deleted accounts" />
            <PageHeader title="Deleted accounts"
                description="When someone deletes their account, it is closed, not erased: they can't sign in, others can't find them, and everything they did stays here for you to trace. You can restore an account at any time."
                actions={<a href={exportUrl} className="btn-outline"><Download size={16} />Export CSV</a>} />
            <PageBody>
                <div className="grid grid-cols-3 gap-3">
                    <Stat label="Closed" value={totals.closed.toLocaleString()} />
                    <Stat label="Restored" value={totals.restored.toLocaleString()} />
                    <Stat label="Last 30 days" value={totals.last_30_days.toLocaleString()} />
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <form className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-3 py-2" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
                        <Search size={16} className="shrink-0 text-muted" />
                        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Name, matric or staff number, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
                    </form>
                    <div className="flex gap-2">
                        <select className="input py-2" value={filters.status ?? ''} onChange={(e) => go({ status: e.target.value })} aria-label="Status">
                            <option value="">Closed and restored</option><option value="closed">Still closed</option><option value="restored">Restored</option>
                        </select>
                        <select className="input py-2" value={filters.type ?? ''} onChange={(e) => go({ type: e.target.value })} aria-label="Type">
                            <option value="">Everyone</option>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                    </div>
                </div>

                {records.data.length === 0 && <EmptyState icon={<UserX size={26} />} title={filters.q || filters.status || filters.type ? 'No deleted accounts match' : 'No one has deleted their account'} />}
                <ul className="mt-4 space-y-3">
                    {records.data.map((r) => {
                        const s = r.snapshot;
                        const expanded = open === r.id;
                        return (
                            <li key={r.id} className="rounded-2xl bg-white">
                                <button className="flex w-full items-start gap-3 p-4 text-left sm:p-5" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[17px] font-bold break-words">{s.name ?? 'Unknown'}</span>
                                            {s.identifier && <span className="text-muted">{s.identifier}</span>}
                                            <span className={`pill ${r.status === 'closed' ? 'bg-sos/10 text-sos' : 'bg-mint text-grove'}`}>{r.status === 'closed' ? 'Deleted' : 'Restored'}</span>
                                        </div>
                                        <p className="text-sm text-muted">{[TYPE[s.member_type ?? ''] ?? s.member_type, s.department ?? s.admin_unit, s.level ? `${s.level} level` : null].filter(Boolean).join(' · ')}</p>
                                        <p className="mt-1 text-[15px]">Deleted {when(r.requested_at)} from {SOURCE[r.source] ?? r.source}{r.closed_by ? ` (${r.closed_by})` : ''}</p>
                                        {r.reason && <p className="mt-1 text-sm break-words text-ink/80">“{r.reason}”</p>}
                                    </div>
                                    <ChevronDown size={18} className={`mt-1 shrink-0 text-muted transition ${expanded ? 'rotate-180' : ''}`} />
                                </button>
                                {expanded && (
                                    <div className="border-t border-line/70 px-4 pt-3 pb-4 sm:px-5">
                                        <dl className="grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
                                            <Row k="Email" v={s.email} /><Row k="Phone" v={s.phone} />
                                            <Row k="Faculty" v={s.faculty} /><Row k="Programme" v={s.programme} />
                                            <Row k="Residence" v={s.residence} /><Row k="Title" v={s.title} />
                                            <Row k="Joined" v={when(s.joined_at)} /><Row k="Last active" v={when(s.last_seen_at)} />
                                            <Row k="Messages sent" v={r.counts.messages.toLocaleString()} /><Row k="Chats and groups" v={r.counts.groups.toLocaleString()} />
                                            <Row k="SOS alerts" v={r.counts.sos.toLocaleString()} /><Row k="Status before" v={r.previous_status} />
                                            <Row k="IP address" v={r.ip_address} /><Row k="Device" v={r.user_agent} />
                                            {r.status === 'restored' && <><Row k="Restored" v={`${when(r.restored_at)}${r.restored_by ? ` by ${r.restored_by}` : ''}`} /><Row k="Why restored" v={r.restore_note} /></>}
                                        </dl>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {r.user_id && <Link href={`/admin/members/${r.user_id}`} className="btn-outline">Open member</Link>}
                                            {can.restore && r.status === 'closed' && <button className="btn-primary" onClick={() => setRestoring(r)}><RotateCcw size={16} />Restore account</button>}
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
                {records.links.length > 3 && (
                    <nav className="mt-4 flex flex-wrap justify-center gap-1" aria-label="Pages">
                        {records.links.map((l, i) => l.url
                            ? <Link key={i} href={l.url} preserveScroll className={`rounded-full px-3 py-1.5 text-sm ${l.active ? 'bg-grove text-white' : 'bg-white'}`} dangerouslySetInnerHTML={{ __html: l.label }} />
                            : <span key={i} className="px-3 py-1.5 text-sm text-muted" dangerouslySetInnerHTML={{ __html: l.label }} />)}
                    </nav>
                )}
            </PageBody>
            {restoring && <Restore rec={restoring} onClose={() => setRestoring(null)} />}
        </AppLayout>
    );
}

const Row = ({ k, v }: { k: string; v: string | number | null | undefined }) => (
    <div className="flex min-w-0 flex-col sm:flex-row sm:gap-2"><dt className="shrink-0 text-muted sm:w-36">{k}</dt><dd className="min-w-0 break-words">{v === null || v === undefined || v === '' ? '—' : v}</dd></div>
);

function Restore({ rec, onClose }: { rec: Rec; onClose: () => void }) {
    const form = useForm({ note: '' });
    return (
        <Modal title={`Restore ${rec.snapshot.name ?? 'this account'}?`} onClose={onClose}>
            <p className="text-[15px]">They can sign in again straight away, with their chats and groups as they were. The deletion stays on record.</p>
            <form className="mt-3" onSubmit={(e) => { e.preventDefault(); form.post(`/admin/deleted-accounts/${rec.id}/restore`, { preserveScroll: true, onSuccess: onClose }); }}>
                <label className="label" htmlFor="r-note">Why (kept in the record)</label>
                <textarea id="r-note" rows={3} className="input" required value={form.data.note} onChange={(e) => form.setData('note', e.target.value)} placeholder="Student asked to come back, letter from the HOD, 16 Nov." />
                {form.errors.note && <p className="mt-1 text-sm text-sos">{form.errors.note}</p>}
                <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>Restore</button></div>
            </form>
        </Modal>
    );
}
