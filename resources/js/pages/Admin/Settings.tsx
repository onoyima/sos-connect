import { Head, router, useForm } from '@inertiajs/react';
import { CircleCheck, CircleAlert, Plug } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';

type InstitutionSettings = {
    allow_foreign_relay?: boolean;
    student_group_creation?: boolean;
    minor_consent_at_admission?: boolean;
    status_audience_max?: string;
    retention_overrides?: Record<string, number | undefined>;
};

type Props = {
    profile: { name: string; short_code: string; status: string; security_phone: string | null; contact_name: string | null; contact_email: string | null; dpo_name: string | null; dpo_email: string | null; dpa_version: string | null };
    settings: InstitutionSettings;
    connector: null | Connector;
    querySets: Record<string, string>;
    signIn: { email_domains: string[]; login_patterns: string[]; auto_sync: boolean; synced_at: string | null };
    retentionDefaults: Record<string, number>;
    directAvailable: boolean;
    can: { settings: boolean; connector: boolean };
};

type Db = { driver?: string; host?: string; port?: number | string; database?: string; username?: string; has_password?: boolean };
type Connector = { base_url: string; key_id: string; query_set: string | null; db: Db; last_tested_at: string | null; last_test_ok: boolean; last_error: string | null };

const RETENTION_LABEL: Record<string, string> = {
    messages: 'Chat messages', statuses: 'Status updates', call_logs: 'Call history', sos_alerts: 'SOS incident records',
    mesh_envelopes: 'Offline relay copies', audit_logs: 'Audit log', inactive_accounts: 'Inactive accounts',
};

export default function Settings({ profile: institution, settings, connector, directAvailable, querySets, signIn, retentionDefaults, can }: Props) {
    const form = useForm<{ security_phone: string; settings: InstitutionSettings }>({ security_phone: institution.security_phone ?? '', settings: { ...settings, retention_overrides: settings.retention_overrides ?? {} } });
    const set = (k: string, v: unknown) => form.setData('settings', { ...form.data.settings, [k]: v });

    return (
        <AppLayout title="Institution settings">
            <Head title="Institution settings" />
            <PageHeader title={institution.name} description={`Settings for ${institution.short_code}. Changes apply to all your members.`} />
            <PageBody narrow>
                <div className="space-y-4">
                    {institution.status !== 'active' && (
                        <div className="rounded-2xl border-l-4 border-amber bg-white p-5">
                            <h2 className="text-lg font-bold">Finish setting up</h2>
                            <ol className="mt-2 ml-5 list-decimal space-y-1 text-[15px] leading-7">
                                <li>Connect your student and staff records below and save. The connection is tested straight away.</li>
                                <li>Under <strong>Sign-in</strong>, add your email domains and matric or staff number formats.</li>
                                <li>Press <strong>Test connection</strong> until it passes.</li>
                                <li>We check your documents and switch your institution on. Members can sign in after that.</li>
                            </ol>
                        </div>
                    )}

                    {can.settings && <InstitutionDetails profile={institution} />}
                    {can.connector && <RecordsConnection connector={connector} directAvailable={directAvailable} querySets={querySets} />}
                    {can.connector && <SignInSettings signIn={signIn} />}

                    {can.settings && <>
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Safety</h2>
                        <label className="label mt-3" htmlFor="sec-phone">Campus security phone</label>
                        <input id="sec-phone" className="input" value={form.data.security_phone} onChange={(e) => form.setData('security_phone', e.target.value)} placeholder="0803 000 0000" />
                        <p className="mt-1 text-sm text-muted">Shown on every SOS screen, and used when the phone app has to fall back to SMS.</p>
                        <label className="mt-4 flex items-start gap-3 text-[15px]">
                            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={!!form.data.settings.allow_foreign_relay} onChange={(e) => set('allow_foreign_relay', e.target.checked)} />
                            <span>Let phones from other institutions carry our SOS alerts when there's no internet. <span className="text-muted">They can't read them. Recommended, because a stranger's phone may be the only way out.</span></span>
                        </label>
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Chat and status</h2>
                        <label className="mt-3 flex items-start gap-3 text-[15px]">
                            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={!!form.data.settings.student_group_creation} onChange={(e) => set('student_group_creation', e.target.checked)} />
                            Students can create their own groups
                        </label>
                        <div className="mt-4 flex items-start gap-4 rounded-xl border border-line p-3">
                            <div className="min-w-0 flex-1">
                                <div id="minors-label" className="font-semibold">Under-18 students can chat and call</div>
                                <p className="mt-0.5 text-sm text-muted">
                                    {form.data.settings.minor_consent_at_admission
                                        ? 'On: students under 18 can chat, call and post status like everyone else (choose this if parents or guardians agree to it at admission).'
                                        : "Off (default): students under 18 can only use SOS and notices, unless you record their parent or guardian's consent on their member page."}
                                    {' '}Changes are recorded in the audit log.
                                </p>
                            </div>
                            <button type="button" role="switch" aria-checked={!!form.data.settings.minor_consent_at_admission} aria-labelledby="minors-label"
                                onClick={() => set('minor_consent_at_admission', !form.data.settings.minor_consent_at_admission)}
                                className={`relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${form.data.settings.minor_consent_at_admission ? 'bg-leaf' : 'bg-line'}`}>
                                <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${form.data.settings.minor_consent_at_admission ? 'translate-x-6' : 'translate-x-1'}`} />
                                <span className="sr-only">{form.data.settings.minor_consent_at_admission ? 'On' : 'Off'}</span>
                            </button>
                        </div>
                        <label className="label mt-4" htmlFor="st-aud">Widest audience for status updates</label>
                        <select id="st-aud" className="input" value={String(form.data.settings.status_audience_max)} onChange={(e) => set('status_audience_max', e.target.value)}>
                            <option value="contacts">People they chat with</option><option value="department">Their department</option><option value="institution">The whole institution</option>
                        </select>
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">How long data is kept</h2>
                        <p className="mt-1 text-[15px] text-muted">In days. You can keep data for less time than the default, but not longer. Leave blank to use the default.</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {Object.entries(retentionDefaults).map(([k, d]) => (
                                <div key={k}>
                                    <label className="label" htmlFor={`ret-${k}`}>{RETENTION_LABEL[k] ?? k.replace(/_/g, ' ')}</label>
                                    <input id={`ret-${k}`} className="input" type="number" min={1} max={d} placeholder={`${d} (default)`} value={form.data.settings.retention_overrides?.[k] ?? ''}
                                        onChange={(e) => set('retention_overrides', { ...form.data.settings.retention_overrides, [k]: e.target.value ? Number(e.target.value) : undefined })} />
                                </div>
                            ))}
                        </div>
                    </section>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted">Data protection officer: {institution.dpo_name ?? 'not set'}{institution.dpo_email ? ` (${institution.dpo_email})` : ''}. Data processing agreement version {institution.dpa_version ?? 'not signed'}.</p>
                        <button className="btn-primary" onClick={() => form.post('/admin/settings')} disabled={form.processing}>Save settings</button>
                    </div>
                    </>}
                </div>
            </PageBody>
        </AppLayout>
    );
}

/** Name, short name and contacts of the institution, editable by its admins at any time. */
function InstitutionDetails({ profile }: { profile: Props['profile'] }) {
    const form = useForm({
        name: profile.name, short_code: profile.short_code, contact_name: profile.contact_name ?? '', contact_email: profile.contact_email ?? '',
        dpo_name: profile.dpo_name ?? '', dpo_email: profile.dpo_email ?? '',
    });
    const field = (key: keyof typeof form.data, label: string, opts: { type?: string; hint?: string; placeholder?: string; upper?: boolean } = {}) => (
        <div>
            <label className="label" htmlFor={`d-${key}`}>{label}</label>
            <input id={`d-${key}`} type={opts.type ?? 'text'} className="input" value={form.data[key]} placeholder={opts.placeholder}
                onChange={(e) => form.setData(key, opts.upper ? e.target.value.toUpperCase() : e.target.value)} />
            {form.errors[key] ? <p className="mt-1 text-sm text-sos">{form.errors[key]}</p> : opts.hint && <p className="mt-1 text-sm text-muted">{opts.hint}</p>}
        </div>
    );
    return (
        <section className="rounded-2xl bg-white p-5">
            <h2 className="text-lg font-bold">Institution details</h2>
            <p className="mt-1 text-sm text-muted">How your institution appears to members, and who we contact about it.</p>
            <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); form.post('/admin/settings/details', { preserveScroll: true }); }}>
                <div className="sm:col-span-2">{field('name', 'Full name')}</div>
                <div className="sm:col-span-2">{field('short_code', 'Short name', { upper: true, hint: 'Letters and numbers, e.g. FUSTE. Used in group names like "All FUSTE Students".' })}</div>
                {field('contact_name', 'Contact person')}
                {field('contact_email', 'Contact email', { type: 'email' })}
                {field('dpo_name', 'Data protection officer')}
                {field('dpo_email', 'Data protection email', { type: 'email' })}
                <div className="sm:col-span-2">
                    <button type="submit" className="btn-primary" disabled={form.processing || !form.isDirty}>{form.processing ? 'Saving…' : 'Save details'}</button>
                </div>
            </form>
        </section>
    );
}

function RecordsConnection({ connector, directAvailable, querySets }: { connector: Connector | null; directAvailable: boolean; querySets: Record<string, string> }) {
    const db = connector?.db ?? {};
    const conn = useForm({
        base_url: connector?.base_url ?? (directAvailable ? 'direct' : 'https://'), rotate_secret: false,
        query_set: connector?.query_set ?? Object.keys(querySets)[0] ?? '',
        db: { driver: db.driver ?? 'mysql', host: db.host ?? '127.0.0.1', port: String(db.port ?? 3306), database: db.database ?? '', username: db.username ?? '', password: '' },
    });
    const direct = conn.data.base_url === 'direct';
    const setDb = (k: string, v: string) => conn.setData('db', { ...conn.data.db, [k]: v });
    const err = Object.values(conn.errors)[0];

    return (
        <section className="rounded-2xl bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold"><Plug size={20} className="text-leaf" />Your records</h2>
            <p className="mt-1 text-[15px] text-muted">Where members' logins, faculties, departments, levels, hostels and courses are read from. Nothing is copied in bulk: each person is read when they sign in, and the structure when you press Sync. Passwords are never stored.</p>
            {directAvailable && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${direct ? 'border-leaf bg-mint/40' : 'border-line'}`}>
                        <input type="radio" className="mt-1 accent-leaf" checked={direct} onChange={() => conn.setData('base_url', 'direct')} />
                        <span><span className="block font-semibold">Database</span><span className="text-sm text-muted">Read your records database directly (read-only user recommended). Nothing else to run.</span></span>
                    </label>
                    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${!direct ? 'border-leaf bg-mint/40' : 'border-line'}`}>
                        <input type="radio" className="mt-1 accent-leaf" checked={!direct} onChange={() => conn.setData('base_url', connector?.base_url && connector.base_url !== 'direct' ? connector.base_url : 'https://')} />
                        <span><span className="block font-semibold">Separate connector</span><span className="text-sm text-muted">A small service on your own network, if the database can't be reached from here.</span></span>
                    </label>
                </div>
            )}
            {direct ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="qs">Records system</label>
                        <select id="qs" className="input" value={conn.data.query_set} onChange={(e) => conn.setData('query_set', e.target.value)}>
                            {Object.entries(querySets).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                    </div>
                    <div><label className="label" htmlFor="db-host">Host</label><input id="db-host" className="input" value={conn.data.db.host} onChange={(e) => setDb('host', e.target.value)} /></div>
                    <div><label className="label" htmlFor="db-port">Port</label><input id="db-port" className="input" inputMode="numeric" value={conn.data.db.port} onChange={(e) => setDb('port', e.target.value)} /></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor="db-name">Database name</label><input id="db-name" className="input" value={conn.data.db.database} onChange={(e) => setDb('database', e.target.value)} /></div>
                    <div><label className="label" htmlFor="db-user">Username</label><input id="db-user" className="input" autoComplete="off" value={conn.data.db.username} onChange={(e) => setDb('username', e.target.value)} /></div>
                    <div><label className="label" htmlFor="db-pass">Password</label><input id="db-pass" className="input" type="password" autoComplete="new-password" placeholder={db.has_password ? 'Unchanged' : ''} value={conn.data.db.password} onChange={(e) => setDb('password', e.target.value)} /></div>
                </div>
            ) : (
                <>
                    <label className="label mt-4" htmlFor="conn-url">Connector address</label>
                    <input id="conn-url" className="input" value={conn.data.base_url} onChange={(e) => conn.setData('base_url', e.target.value)} />
                    {connector && connector.base_url !== 'direct' && (
                        <label className="mt-3 flex items-center gap-2 text-sm">
                            <input type="checkbox" className="size-4 accent-leaf" checked={conn.data.rotate_secret} onChange={(e) => conn.setData('rotate_secret', e.target.checked)} />
                            Make a new shared secret (you'll need to update the connector's config)
                        </label>
                    )}
                </>
            )}
            {err && <p className="mt-2 text-sm text-sos">{err}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => conn.post('/admin/connector', { preserveScroll: true })} disabled={conn.processing}>{direct ? 'Save and test' : 'Save'}</button>
                {connector && <button className="btn-outline" onClick={() => router.post('/admin/connector/test', {}, { preserveScroll: true })}>Test connection</button>}
            </div>
            {connector && (
                <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${connector.last_test_ok ? 'bg-mint text-grove' : 'bg-amber/15 text-ink'}`}>
                    {connector.last_test_ok ? <CircleCheck size={18} className="mt-0.5 shrink-0" /> : <CircleAlert size={18} className="mt-0.5 shrink-0 text-[#8a5a12]" />}
                    <span>
                        {connector.last_tested_at
                            ? connector.last_test_ok ? `Working. Last tested ${new Date(connector.last_tested_at).toLocaleString()}.` : `Last test failed: ${connector.last_error ?? 'no reply'}`
                            : 'Not tested yet.'}
                        {connector.base_url !== 'direct' && <span className="block text-xs opacity-75">Key ID {connector.key_id}</span>}
                    </span>
                </div>
            )}
        </section>
    );
}

function SignInSettings({ signIn }: { signIn: Props['signIn'] }) {
    const form = useForm({ domains: signIn.email_domains.join('\n'), patterns: signIn.login_patterns.join('\n'), auto_sync: signIn.auto_sync });
    const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    const save = () => {
        form.transform((d) => ({ email_domains: lines(d.domains), login_patterns: lines(d.patterns), auto_sync: d.auto_sync }));
        form.post('/admin/sign-in', { preserveScroll: true });
    };
    const err = Object.values(form.errors)[0];

    return (
        <section className="rounded-2xl bg-white p-5">
            <h2 className="text-lg font-bold">Sign-in</h2>
            <p className="mt-1 text-[15px] text-muted">The sign-in page doesn't list institutions. It recognises your members by what they type, so add your school email domains and your matric and staff number formats.</p>
            <label className="label mt-4" htmlFor="domains">Email domains, one per line</label>
            <textarea id="domains" className="input min-h-20 font-mono text-sm" value={form.data.domains} onChange={(e) => form.setData('domains', e.target.value)} placeholder="school.edu" />
            <p className="mt-1 text-xs text-muted">Subdomains count too: school.edu also covers student.school.edu.</p>
            <label className="label mt-4" htmlFor="patterns">Matric and staff number formats, one per line</label>
            <textarea id="patterns" className="input min-h-20 font-mono text-sm" value={form.data.patterns} onChange={(e) => form.setData('patterns', e.target.value)} placeholder={'ABC/*/##/####\nSTF/####'} />
            <p className="mt-1 text-xs text-muted"><code>*</code> means anything, <code>#</code> means one digit. Capital letters don't matter.</p>
            <label className="mt-4 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-leaf" checked={form.data.auto_sync} onChange={(e) => form.setData('auto_sync', e.target.checked)} />
                <span>Check the records every night for new or renamed faculties, departments, units, hostels and courses.
                    {signIn.synced_at && <span className="block text-muted">Last checked {new Date(signIn.synced_at).toLocaleString()}.</span>}</span>
            </label>
            {err && <p className="mt-2 text-sm text-sos">{err}</p>}
            <button className="btn-primary mt-4" onClick={save} disabled={form.processing}>Save sign-in settings</button>
        </section>
    );
}
