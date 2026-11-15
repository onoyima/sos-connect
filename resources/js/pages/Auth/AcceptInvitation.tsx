import { Head, Link, useForm } from '@inertiajs/react';
import { signedIn } from '@/lib/session';
import { AuthShell } from '@/components/AuthShell';

type Props = { token: string; name: string; email: string; institution: { id: number; name: string; short_code: string } | null };

export default function AcceptInvitation({ token, name, email, institution }: Props) {
    const form = useForm({ password: '', password_confirmation: '', accept: false });
    return (
        <AuthShell>
            <Head title="Set your password" />
            <h1 className="text-2xl font-bold">Welcome, {name.split(' ')[0]}</h1>
            <p className="mt-1 text-[15px] text-muted">{institution?.name} has invited you to SOS Connect. Choose a password to finish. You'll sign in with {email}.</p>
            <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); form.post(`/invite/${token}`, { onSuccess: () => signedIn() }); }}>
                <div>
                    <label className="label" htmlFor="inv-pass">Password <span className="font-normal text-muted">(at least 10 characters)</span></label>
                    <input id="inv-pass" type="password" autoComplete="new-password" className="input py-3" value={form.data.password} onChange={(e) => form.setData('password', e.target.value)} />
                </div>
                <div>
                    <label className="label" htmlFor="inv-pass2">Type it again</label>
                    <input id="inv-pass2" type="password" autoComplete="new-password" className="input py-3" value={form.data.password_confirmation} onChange={(e) => form.setData('password_confirmation', e.target.value)} />
                </div>
                <label className="flex items-start gap-3 text-[15px]">
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={form.data.accept} onChange={(e) => form.setData('accept', e.target.checked)} />
                    <span>I've read the <a className="font-semibold text-leaf underline" href="/legal/terms-of-service" target="_blank">terms</a>, the <a className="font-semibold text-leaf underline" href="/legal/privacy-policy" target="_blank">privacy policy</a> and the <a className="font-semibold text-leaf underline" href="/legal/sos-emergency-notice" target="_blank">SOS notice</a>.</span>
                </label>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <button className="btn-primary w-full py-3 text-[15px]" disabled={form.processing || !form.data.accept}>Set password</button>
            </form>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-5 text-sm">
                <Link href="/login" className="font-medium text-leaf">Already set a password? Sign in</Link>
                <Link href="/legal" className="font-medium text-muted hover:text-ink">Terms and privacy</Link>
            </div>
        </AuthShell>
    );
}
