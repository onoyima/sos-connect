import { Head, Link, useForm } from '@inertiajs/react';
import { AuthShell } from '@/components/AuthShell';

type Field = { key: string; label: string; type?: string; placeholder?: string; hint?: string; half?: boolean };

const SECTIONS: { title: string; note?: string; fields: Field[] }[] = [
    { title: 'Your institution', fields: [
        { key: 'name', label: 'Full name', placeholder: 'Full name of the institution' },
        { key: 'short_code', label: 'Short code', placeholder: 'ABC', half: true },
        { key: 'country', label: 'Country code', placeholder: 'NG', hint: 'NG, GH, KE, ZA and so on', half: true },
        { key: 'email_domain', label: 'Official email domain', placeholder: 'school.edu or staff.school.edu', hint: 'Your institution domain or sub-domain: the part after @ in your work email. You can also paste your work email here.' },
    ] },
    { title: 'You', note: 'The person setting this up, usually from the ICT unit.', fields: [
        { key: 'contact_name', label: 'Full name', half: true },
        { key: 'contact_title', label: 'Position', placeholder: 'Director of ICT', half: true },
        { key: 'contact_email', label: 'Official email', type: 'email', half: true },
        { key: 'contact_phone', label: 'Phone', type: 'tel', half: true },
    ] },
    { title: 'Safety and data protection', fields: [
        { key: 'security_phone', label: 'Campus security phone', type: 'tel', hint: 'Shown on every SOS screen and used for SMS when there is no data.' },
        { key: 'dpo_name', label: 'Data protection officer', half: true },
        { key: 'dpo_email', label: "Officer's email", type: 'email', half: true },
    ] },
    { title: 'Admin password', note: 'For signing in to manage your institution. At least 12 characters.', fields: [
        { key: 'password', label: 'Password', type: 'password', half: true },
        { key: 'password_confirmation', label: 'Confirm password', type: 'password', half: true },
    ] },
];

export default function Register({ dpaVersion }: { dpaVersion: string }) {
    const form = useForm<Record<string, string | boolean>>({
        name: '', short_code: '', country: 'NG', email_domain: '', contact_name: '', contact_title: '', contact_email: '', contact_phone: '',
        security_phone: '', dpo_name: '', dpo_email: '', password: '', password_confirmation: '', accept_dpa: false, accept_terms: false, confirm_authority: false,
    });
    const agreementError = form.errors.accept_dpa || form.errors.accept_terms || form.errors.confirm_authority;

    return (
        <AuthShell wide>
            <Head title="Register an institution" />
            <h1 className="text-2xl font-bold">Register your institution</h1>
            <p className="mt-1 max-w-[60ch] text-[15px] text-muted">
                After this, you connect your student and staff records from Settings (a read-only database user, or a small connector on your own network). We then verify your institution and switch it on.
            </p>

            <form className="mt-8 space-y-8" onSubmit={(e) => { e.preventDefault(); form.post('/register-institution'); }}>
                {SECTIONS.map((s) => (
                    <fieldset key={s.title}>
                        <legend className="text-base font-bold text-grove">{s.title}</legend>
                        {s.note && <p className="mt-0.5 text-sm text-muted">{s.note}</p>}
                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                            {s.fields.map((f) => (
                                <div key={f.key} className={f.half ? '' : 'sm:col-span-2'}>
                                    <label className="label" htmlFor={`f-${f.key}`}>{f.label}</label>
                                    <input id={`f-${f.key}`} className="input" type={f.type ?? 'text'} placeholder={f.placeholder}
                                        value={String(form.data[f.key] ?? '')} onChange={(e) => form.setData(f.key, e.target.value)} />
                                    {form.errors[f.key] ? <p className="mt-1 text-sm text-sos">{form.errors[f.key]}</p> : f.hint && <p className="mt-1 text-sm text-muted">{f.hint}</p>}
                                </div>
                            ))}
                        </div>
                    </fieldset>
                ))}

                <fieldset className="rounded-2xl bg-white p-5">
                    <legend className="sr-only">Agreements</legend>
                    <div className="space-y-3 text-[15px]">
                        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={!!form.data.confirm_authority} onChange={(e) => form.setData('confirm_authority', e.target.checked)} />
                            I'm allowed to sign agreements for this institution.</label>
                        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={!!form.data.accept_dpa} onChange={(e) => form.setData('accept_dpa', e.target.checked)} />
                            <span>The institution accepts the <Link className="font-semibold text-leaf underline" href="/legal/data-processing-agreement">data processing agreement</Link> (version {dpaVersion}) and is responsible for its members' data.</span></label>
                        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={!!form.data.accept_terms} onChange={(e) => form.setData('accept_terms', e.target.checked)} />
                            <span>The institution accepts the <Link className="font-semibold text-leaf underline" href="/legal/terms-of-service">terms of service</Link> and has read the <Link className="font-semibold text-leaf underline" href="/legal/sos-emergency-notice">SOS notice</Link>.</span></label>
                    </div>
                    {agreementError && <p className="mt-3 text-sm text-sos">Tick all three boxes to continue.</p>}
                </fieldset>

                <div className="flex flex-wrap items-center gap-4">
                    <button className="btn-primary px-6 py-3 text-[15px]" disabled={form.processing}>Register institution</button>
                    <Link href="/login" className="text-sm font-medium text-muted hover:text-ink">Back to sign in</Link>
                </div>
            </form>
        </AuthShell>
    );
}
