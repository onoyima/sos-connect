import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import { Building2, CircleCheck, CircleAlert } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, Modal, PageBody, PageHeader } from '@/components/ui';

type Inst = { id: number; name: string; short_code: string; country: string; status: string; contact_name: string; contact_email: string; dpo_email: string | null; dpa_version: string | null; dpa_accepted_by: string | null; verified_at: string | null; users_count: number; connector_ok: boolean };

const STATUS_TONE: Record<string, string> = { active: 'bg-mint text-grove', pending: 'bg-amber/25 text-[#7a4d0b]', suspended: 'bg-sos/10 text-sos' };

export default function Institutions({ institutions }: { institutions: Inst[] }) {
    const [acting, setActing] = useState<{ inst: Inst; status: string } | null>(null);
    const [note, setNote] = useState('');
    const [force, setForce] = useState(false);

    return (
        <AppLayout title="Institutions">
            <Head title="Institutions" />
            <PageHeader title="Institutions" description="Before switching an institution on, confirm the contact uses the official email domain, get a signed letter of authority, and check that the records connection test passes." />
            <PageBody>
                {institutions.length === 0 && <EmptyState icon={<Building2 size={26} />} title="No institutions have registered yet">They sign up at /register-institution.</EmptyState>}
                <div className="space-y-3">
                    {institutions.map((i) => (
                        <article key={i.id} className="flex flex-col gap-4 rounded-2xl bg-white p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-lg font-bold">{i.name}</h2>
                                    <span className="text-muted">{i.short_code}, {i.country}</span>
                                    <span className={`pill ${STATUS_TONE[i.status] ?? 'bg-mist text-muted'}`}>{i.status}</span>
                                </div>
                                <p className="text-[15px]">{i.contact_name}, <a className="break-all text-leaf underline" href={`mailto:${i.contact_email}`}>{i.contact_email}</a></p>
                                <p className="text-sm text-muted">Data protection officer: {i.dpo_email ?? 'not given'}. Agreement {i.dpa_version ?? 'not accepted'}{i.dpa_accepted_by ? `, accepted by ${i.dpa_accepted_by}` : ''}. {i.users_count} members.</p>
                                <p className={`inline-flex items-center gap-1.5 text-sm font-medium ${i.connector_ok ? 'text-leaf' : 'text-[#8a5a12]'}`}>
                                    {i.connector_ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}{i.connector_ok ? 'Records connection working' : 'Records connection not working yet'}
                                </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                {i.status !== 'active' && <button className="btn-primary" onClick={() => { setNote(''); setForce(false); setActing({ inst: i, status: 'active' }); }}>Switch on</button>}
                                {i.status === 'active' && <button className="btn-outline text-sos" onClick={() => { setNote(''); setActing({ inst: i, status: 'suspended' }); }}>Suspend</button>}
                            </div>
                        </article>
                    ))}
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
