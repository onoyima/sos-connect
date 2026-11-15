import { Head, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { HeartHandshake, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Avatar, EmptyState, Modal, PageBody, PageHeader } from '@/components/ui';

type Parent = { id: number; name: string; email: string | null; phone: string | null; status: string; has_password: boolean; children: { name: string; identifier: string | null; relationship: string | null }[] };

export default function Parents({ parents }: { parents: Parent[] }) {
    const [inviting, setInviting] = useState(false);
    return (
        <AppLayout title="Parents">
            <Head title="Parents and guardians" />
            <PageHeader
                title="Parents and guardians"
                description="Parents see your university's announcements and the parents group, and can send an SOS. They can't browse students or start private chats."
                actions={<button className="btn-primary" onClick={() => setInviting(true)}><UserPlus size={16} />Invite a parent</button>}
            />
            <PageBody narrow>
                {parents.length === 0 ? <EmptyState icon={<HeartHandshake size={26} />} title="No parents yet">Invite a parent and link them to their child by matric number.</EmptyState> : (
                    <div className="overflow-hidden rounded-2xl bg-white">
                        {parents.map((p) => (
                            <div key={p.id} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                                <Avatar name={p.name} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold">{p.name}{!p.has_password && <span className="ml-2 pill bg-amber/25 text-[#7a4d0b]">Invitation not used yet</span>}</div>
                                    <div className="truncate text-sm text-muted">{[p.email, p.phone].filter(Boolean).join(', ')}</div>
                                    <div className="truncate text-sm">{p.children.map((c) => `${c.relationship ? c.relationship + ' of ' : ''}${c.name}${c.identifier ? ` (${c.identifier})` : ''}`).join('; ')}</div>
                                </div>
                                {!p.has_password && <button className="btn-outline shrink-0" onClick={() => router.post(`/admin/parents/${p.id}/link`, {}, { preserveScroll: true })}>Get sign-up link</button>}
                            </div>
                        ))}
                    </div>
                )}
            </PageBody>
            {inviting && <Invite onClose={() => setInviting(false)} />}
        </AppLayout>
    );
}

function Invite({ onClose }: { onClose: () => void }) {
    const form = useForm({ name: '', email: '', phone: '', student_identifier: '', relationship: 'Parent' });
    return (
        <Modal title="Invite a parent or guardian" onClose={onClose}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); form.post('/admin/parents', { onSuccess: onClose, preserveScroll: true }); }}>
                <div><label className="label" htmlFor="p-name">Parent's full name</label><input id="p-name" className="input" value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="p-email">Email</label><input id="p-email" type="email" className="input" value={form.data.email} onChange={(e) => form.setData('email', e.target.value)} /></div>
                    <div><label className="label" htmlFor="p-phone">Phone</label><input id="p-phone" type="tel" className="input" value={form.data.phone} onChange={(e) => form.setData('phone', e.target.value)} /></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                    <div><label className="label" htmlFor="p-student">Child's matric number</label><input id="p-student" className="input" value={form.data.student_identifier} onChange={(e) => form.setData('student_identifier', e.target.value)} placeholder="Matric number" /></div>
                    <div><label className="label" htmlFor="p-rel">Relationship</label>
                        <select id="p-rel" className="input" value={form.data.relationship} onChange={(e) => form.setData('relationship', e.target.value)}>
                            {['Parent', 'Mother', 'Father', 'Guardian', 'Sponsor'].map((r) => <option key={r}>{r}</option>)}
                        </select></div>
                </div>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <p className="text-sm text-muted">You'll get a one-time link to send them. It works for 14 days.</p>
                <button className="btn-primary w-full py-3" disabled={form.processing || !form.data.name || !form.data.email || !form.data.student_identifier}>Create invitation</button>
            </form>
        </Modal>
    );
}
