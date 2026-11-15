import { Head, router, useForm, usePage } from '@inertiajs/react';
import { Database, Download, FileArchive, ScanFace, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Avatar, EmptyState, Modal, PageBody, PageHeader, Pager, memberLabel, when } from '@/components/ui';

type Person = {
    id: number; name: string; identifier: string | null; member_type: string; department: string | null; is_minor: boolean;
    face: null | { completed_at: string | null; quality: number | null; device: string; sent_file: boolean; sent_db: boolean; thumb: string | null };
};
type Exp = { id: number; kind: 'file' | 'database'; scope: string; status: string; people: number; images: number; error: string | null; by: string | null; at: string | null; download: string | null };
type Target = { driver: string; host: string; port: number; database: string; username: string; prefix: string; has_password: boolean; saved: boolean };
type Props = {
    people: { data: Person[]; links: { url: string | null; label: string; active: boolean }[] };
    stats: { total: number; complete: number; missing: number; not_sent: number; required: boolean };
    exports: Exp[]; target: Target; filters: { q?: string; status?: string; type?: string }; can: { export: boolean };
};
type Detail = {
    name: string; identifier: string | null;
    face: null | {
        completed_at: string | null; quality: number | null; device: string; consent_at: string | null; sent_file_at: string | null; sent_db_at: string | null;
        liveness: { blinks?: number; mouth?: boolean; turns?: boolean; nods?: boolean; seconds?: number } | null;
        captures: { id: number; pose: string; label: string; url: string; width: number; height: number; quality: number; metrics: Record<string, number> | null }[];
    };
};

/** Admin > Face capture: progress, each person's photos, and sending them to the school's systems. */
export default function Faces({ people, stats, exports, target, filters, can }: Props) {
    const errors = usePage().props.errors as Record<string, string>;
    const [q, setQ] = useState(filters.q ?? '');
    const [open, setOpen] = useState<number | null>(null);
    const [sending, setSending] = useState<'file' | 'database' | null>(null);
    const [targetOpen, setTargetOpen] = useState(false);
    const filter = (f: Record<string, string | undefined>) => router.get('/admin/faces', { ...filters, ...f }, { preserveState: true, replace: true });
    const running = exports.some((x) => x.status === 'queued' || x.status === 'running');
    useEffect(() => {
        if (!running) return;
        const t = setInterval(() => router.reload({ only: ['exports', 'stats'] }), 4000);
        return () => clearInterval(t);
    }, [running]);
    const pct = stats.total ? Math.round((stats.complete / stats.total) * 100) : 0;

    return (
        <AppLayout title="Face capture">
            <Head title="Face capture" />
            <PageHeader title="Face capture"
                description={`Students and staff capture their face from their account menu${stats.required ? ' (required: they are reminded until they do)' : ' (optional; you can make it required in Features)'}. Photos are stored encrypted.`}
                actions={can.export && <>
                    <button className="btn-outline" onClick={() => setSending('file')}><FileArchive size={16} />Download for the school</button>
                    <button className="btn-primary" onClick={() => (target.saved ? setSending('database') : setTargetOpen(true))}><Database size={16} />Send to school database</button>
                </>} />
            <PageBody>
                <div className="grid gap-3 sm:grid-cols-4">
                    <Stat label="Captured" value={`${stats.complete}`} sub={`${pct}% of ${stats.total}`} />
                    <Stat label="Not yet" value={`${stats.missing}`} sub="students and staff" />
                    <Stat label="Not sent to school" value={`${stats.not_sent}`} sub="captured, not exported" />
                    <div className="rounded-2xl bg-white p-4">
                        <div className="text-sm text-muted">School database</div>
                        <div className="mt-1 truncate font-semibold">{target.saved ? `${target.database} on ${target.host}` : 'Not set up'}</div>
                        {can.export && <button className="mt-1 text-sm font-medium text-leaf" onClick={() => setTargetOpen(true)}>{target.saved ? 'Change' : 'Set up'}</button>}
                    </div>
                </div>
                {(errors.export || errors.target) && <p role="alert" className="mt-4 rounded-xl bg-sos/10 px-3 py-2.5 text-sm text-sos">{errors.export ?? errors.target}</p>}

                {exports.length > 0 && (
                    <section className="mt-6">
                        <h2 className="mb-2 text-sm font-semibold text-muted uppercase">Recent exports</h2>
                        <div className="overflow-hidden rounded-2xl bg-white">
                            {exports.map((x) => (
                                <div key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 text-sm last:border-0">
                                    {x.kind === 'file' ? <FileArchive size={18} className="text-muted" /> : <Database size={18} className="text-muted" />}
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium">{x.kind === 'file' ? 'Encrypted file' : 'School database'} · {x.scope === 'new' ? 'not sent before' : 'everyone'}</div>
                                        <div className="text-muted">{when(x.at)}{x.by ? ` by ${x.by}` : ''} · {x.status === 'done' ? `${x.people} people, ${x.images} photos` : x.status === 'failed' ? <span className="text-sos">{x.error}</span> : 'working…'}</div>
                                    </div>
                                    {x.download && <a className="btn-outline" href={x.download}><Download size={16} />Download</a>}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-2">
                    <form className="relative min-w-0 flex-1 basis-56" onSubmit={(e) => { e.preventDefault(); filter({ q: q || undefined }); }}>
                        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                        <input className="input pl-9" placeholder="Name or ID number" value={q} onChange={(e) => setQ(e.target.value)} />
                    </form>
                    <select className="input w-auto" value={filters.status ?? ''} onChange={(e) => filter({ status: e.target.value || undefined })} aria-label="Status">
                        <option value="">Everyone</option><option value="done">Captured</option><option value="missing">Not yet</option><option value="not_sent">Not sent to school</option>
                    </select>
                    <select className="input w-auto" value={filters.type ?? ''} onChange={(e) => filter({ type: e.target.value || undefined })} aria-label="Type">
                        <option value="">Students and staff</option><option value="student">Students</option><option value="staff">Staff</option>
                    </select>
                </div>

                {people.data.length === 0 ? <EmptyState icon={<ScanFace size={26} />} title="Nobody here">Try another filter.</EmptyState> : (
                    <div className="mt-3 overflow-hidden rounded-2xl bg-white">
                        {people.data.map((p) => (
                            <button key={p.id} onClick={() => p.face && setOpen(p.id)} disabled={!p.face}
                                className="flex w-full items-center gap-3 border-b border-line/70 px-4 py-3 text-left last:border-0 enabled:hover:bg-mist/50">
                                {p.face?.thumb ? <img src={p.face.thumb} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover" loading="lazy" /> : <Avatar name={p.name} size={40} />}
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-semibold">{p.name}</div>
                                    <div className="truncate text-sm text-muted">{[p.identifier, memberLabel(p.member_type), p.department].filter(Boolean).join(' · ')}</div>
                                </div>
                                {p.face ? (
                                    <div className="shrink-0 text-right text-sm">
                                        <span className="pill bg-mint text-grove">Captured</span>
                                        <div className="mt-1 text-xs text-muted">{when(p.face.completed_at)}{p.face.quality !== null ? ` · ${Math.round(p.face.quality)}/100` : ''}{p.face.sent_file || p.face.sent_db ? ' · sent' : ''}</div>
                                    </div>
                                ) : <span className="pill shrink-0 bg-mist text-muted">{p.is_minor ? 'Under 18' : 'Not yet'}</span>}
                            </button>
                        ))}
                    </div>
                )}
                <Pager links={people.links} />
            </PageBody>

            {open !== null && <PersonPanel id={open} canDelete={can.export} onClose={() => setOpen(null)} />}
            {sending && <SendDialog kind={sending} onClose={() => setSending(null)} />}
            {targetOpen && <TargetDialog target={target} onClose={() => setTargetOpen(false)} />}
        </AppLayout>
    );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return <div className="rounded-2xl bg-white p-4"><div className="text-sm text-muted">{label}</div><div className="mt-1 text-2xl font-bold text-grove">{value}</div><div className="text-xs text-muted">{sub}</div></div>;
}

function PersonPanel({ id, canDelete, onClose }: { id: number; canDelete: boolean; onClose: () => void }) {
    const [d, setD] = useState<Detail | null>(null);
    useEffect(() => { fetch(`/admin/faces/people/${id}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then((r) => r.json()).then(setD).catch(() => {}); }, [id]);
    const live = d?.face?.liveness;
    return (
        <Modal title={d ? `${d.name}${d.identifier ? ` (${d.identifier})` : ''}` : 'Loading…'} onClose={onClose} wide>
            {d?.face ? (
                <>
                    <p className="text-sm text-muted">
                        Captured {when(d.face.completed_at)} on {d.face.device === 'phone' ? 'the phone app' : 'the website'}{d.face.quality !== null ? ` · quality ${Math.round(d.face.quality)}/100` : ''}.
                        {' '}Live checks: {live?.blinks ?? 0} blinks, mouth {live?.mouth ? 'opened' : 'no'}, head turned {live?.turns ? 'both ways' : 'no'}{live?.seconds ? `, ${live.seconds}s` : ''}.
                        {d.face.sent_file_at || d.face.sent_db_at ? ` Sent to the school ${when(d.face.sent_db_at ?? d.face.sent_file_at)}.` : ' Not sent to the school yet.'}
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {d.face.captures.map((c) => (
                            <figure key={c.id} className="overflow-hidden rounded-xl bg-mist">
                                <a href={c.url} target="_blank" rel="noreferrer"><img src={c.url} alt={c.label} className="aspect-[3/4] w-full object-cover" /></a>
                                <figcaption className="px-2 py-1 text-xs">
                                    <div className="font-medium">{c.label}</div>
                                    <div className="text-muted">{c.width}×{c.height} · {Math.round(c.quality)}/100</div>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                    {canDelete && (
                        <button className="mt-4 inline-flex items-center gap-1.5 text-sm text-sos hover:underline"
                            onClick={() => confirm(`Delete ${d.name}'s face photos here? Copies already sent to the school are not affected.`) && router.delete(`/admin/faces/people/${id}`, { onSuccess: onClose, preserveScroll: true })}>
                            <Trash2 size={14} />Delete these photos
                        </button>
                    )}
                </>
            ) : d ? <p className="text-sm text-muted">No face capture.</p> : null}
        </Modal>
    );
}

function SendDialog({ kind, onClose }: { kind: 'file' | 'database'; onClose: () => void }) {
    const form = useForm({ kind, scope: 'new', password: '', password_confirmation: '' });
    return (
        <Modal title={kind === 'file' ? 'Download face photos for the school' : 'Send face photos to the school database'} onClose={onClose}>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); form.post('/admin/faces/export', { onSuccess: onClose, preserveScroll: true }); }}>
                <p className="text-sm text-muted">
                    {kind === 'file'
                        ? 'A ZIP file, encrypted with a password you choose (AES-256): a folder per person with their photos and face points, plus people.csv listing ID numbers and names. Share the password separately. The file is removed from this server after a day.'
                        : 'Photos and details are written into the tables face_people and face_images in the school database (photos as images, with ID numbers and records IDs). A newer capture of the same person is marked as the current one.'}
                </p>
                <fieldset className="space-y-2">
                    <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.data.scope === 'new'} onChange={() => form.setData('scope', 'new')} />Only people not sent this way before</label>
                    <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.data.scope === 'all'} onChange={() => form.setData('scope', 'all')} />Everyone captured</label>
                </fieldset>
                {kind === 'file' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div><label className="label" htmlFor="fx-pass">File password</label><input id="fx-pass" type="password" autoComplete="new-password" className="input" value={form.data.password} onChange={(e) => form.setData('password', e.target.value)} /></div>
                        <div><label className="label" htmlFor="fx-pass2">Type it again</label><input id="fx-pass2" type="password" autoComplete="new-password" className="input" value={form.data.password_confirmation} onChange={(e) => form.setData('password_confirmation', e.target.value)} /></div>
                    </div>
                )}
                {(form.errors.password || (form.errors as Record<string, string>).export) && <p className="text-sm text-sos">{form.errors.password ?? (form.errors as Record<string, string>).export}</p>}
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>{form.processing ? 'Working…' : kind === 'file' ? 'Make the file' : 'Send now'}</button></div>
            </form>
        </Modal>
    );
}

function TargetDialog({ target, onClose }: { target: Target; onClose: () => void }) {
    const form = useForm({ driver: target.driver === 'mariadb' ? 'mariadb' : 'mysql', host: target.host, port: target.port, database: target.database, username: target.username, password: '', prefix: target.prefix });
    return (
        <Modal title="School database for face data" onClose={onClose} wide>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); form.post('/admin/faces/target', { onSuccess: onClose, preserveScroll: true }); }}>
                <p className="text-sm text-muted">Use a database login that may create tables and write (CREATE, INSERT, UPDATE). The sign-in records login is usually read-only, so it often needs a different one. Saving tests the connection and creates the two tables if needed.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2"><label className="label" htmlFor="ft-host">Server (host)</label><input id="ft-host" className="input" value={form.data.host} onChange={(e) => form.setData('host', e.target.value)} /></div>
                    <div><label className="label" htmlFor="ft-port">Port</label><input id="ft-port" type="number" className="input" value={form.data.port} onChange={(e) => form.setData('port', Number(e.target.value))} /></div>
                    <div><label className="label" htmlFor="ft-db">Database name</label><input id="ft-db" className="input" value={form.data.database} onChange={(e) => form.setData('database', e.target.value)} /></div>
                    <div><label className="label" htmlFor="ft-user">Username</label><input id="ft-user" className="input" autoComplete="off" value={form.data.username} onChange={(e) => form.setData('username', e.target.value)} /></div>
                    <div><label className="label" htmlFor="ft-pass">Password</label><input id="ft-pass" type="password" className="input" autoComplete="new-password" placeholder={target.has_password ? 'Unchanged' : ''} value={form.data.password} onChange={(e) => form.setData('password', e.target.value)} /></div>
                    <div><label className="label" htmlFor="ft-driver">Type</label><select id="ft-driver" className="input" value={form.data.driver} onChange={(e) => form.setData('driver', e.target.value)}><option value="mysql">MySQL</option><option value="mariadb">MariaDB</option></select></div>
                    <div><label className="label" htmlFor="ft-prefix">Table name prefix</label><input id="ft-prefix" className="input" value={form.data.prefix} onChange={(e) => form.setData('prefix', e.target.value)} /></div>
                </div>
                {Object.values(form.errors)[0] && <p className="text-sm text-sos">{Object.values(form.errors)[0]}</p>}
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing}>{form.processing ? 'Testing…' : 'Save and test'}</button></div>
            </form>
        </Modal>
    );
}
