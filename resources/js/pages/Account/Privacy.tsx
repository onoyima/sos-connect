import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import { Download, FilePen, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Modal, PageBody, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

export default function Privacy({ policyVersion }: { policyVersion: string }) {
    const [msg, setMsg] = useState<string | null>(null);
    const [type, setType] = useState('rectification');
    const [details, setDetails] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [typed, setTyped] = useState('');

    const download = () => { window.location.href = '/api/privacy/export'; };
    const submit = async () => {
        const r = await api<{ due_at: string }>('/privacy/requests', { body: { type, details } });
        setMsg(`Request received. You'll get an answer by ${new Date(r.due_at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}.`);
        setDetails('');
    };
    const [reason, setReason] = useState('');
    const deleteAccount = async () => {
        await api('/privacy/account', { method: 'DELETE', body: { confirm: 'DELETE', reason: reason.trim() || null } });
        window.location.replace('/login?deleted=1'); // already signed out by the server
    };

    return (
        <AppLayout title="My data and privacy">
            <Head title="My data and privacy" />
            <PageHeader title="My data and privacy" description="See what SOS Connect keeps about you, take a copy, or ask for it to be changed or removed." />
            <PageBody narrow>
                <div className="space-y-4">
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">What we keep</h2>
                        <ul className="mt-2 ml-5 list-disc space-y-1 text-[15px] leading-7">
                            <li>Your name, role, department and level, as your institution shares them</li>
                            <li>Messages and status updates you send</li>
                            <li>SOS alerts you raise, with location if you allowed it</li>
                            <li>Your call history (not the calls themselves)</li>
                            <li>The security keys of the devices you sign in on</li>
                        </ul>
                        <p className="mt-3 text-[15px] text-muted">We never store your password. Your institution checks it. You're on policy version {policyVersion}. <Link className="font-semibold text-leaf underline" href="/legal/privacy-policy">Read the privacy policy</Link>.</p>
                        <button className="btn-primary mt-4" onClick={download}><Download size={16} />Download my data</button>
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><FilePen size={20} className="text-leaf" />Ask for a change</h2>
                        <div className="mt-3 space-y-3">
                            <div>
                                <label className="label" htmlFor="pr-type">What would you like?</label>
                                <select id="pr-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                                    <option value="rectification">Correct something that's wrong</option>
                                    <option value="erasure">Erase specific data</option>
                                    <option value="restriction">Limit how my data is used</option>
                                    <option value="objection">Object to how my data is used</option>
                                </select>
                            </div>
                            <div>
                                <label className="label" htmlFor="pr-details">Details</label>
                                <textarea id="pr-details" className="input" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="My department is listed as Physics but I moved to Computer Science." />
                            </div>
                            <button className="btn-primary" disabled={!details.trim()} onClick={submit}>Send request</button>
                            {msg && <p className="rounded-xl bg-mint px-3 py-2 text-sm text-grove">{msg}</p>}
                            <p className="text-sm text-muted">If you're unhappy with the answer, you can complain to your data protection authority. In Nigeria that's the Nigeria Data Protection Commission.</p>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-sos/30 bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-sos"><Trash2 size={20} />Delete my account</h2>
                        <p className="mt-2 text-[15px] leading-7">Your account is closed: you're signed out everywhere, other people can no longer find or message you, and you can't sign in again. To protect everyone, your institution keeps a record of the account and what was sent from it, and can restore it if you ask. Your request to erase your data goes to your institution's data protection officer, who answers within 30 days.</p>
                        <button className="btn-danger mt-4" onClick={() => { setTyped(''); setConfirmDelete(true); }}>Delete my account</button>
                    </section>
                </div>
            </PageBody>

            {confirmDelete && (
                <Modal title="Delete your account?" onClose={() => setConfirmDelete(false)}>
                    <p className="text-[15px]">You'll be signed out and can't sign in again unless your school restores the account.</p>
                    <label className="label mt-3" htmlFor="del-reason">Why are you leaving? (optional)</label>
                    <textarea id="del-reason" className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <p className="mt-3 text-[15px]">Type <strong>DELETE</strong> to confirm.</p>
                    <input className="input mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="Type DELETE to confirm" />
                    <div className="mt-4 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Keep my account</button>
                        <button className="btn-danger" disabled={typed !== 'DELETE'} onClick={deleteAccount}>Delete account</button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}
