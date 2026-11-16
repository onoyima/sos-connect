import { Head, Link, useForm } from '@inertiajs/react';
import { KeyRound, RefreshCw, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { signedIn } from '@/lib/session';

type Mode = 'phone' | 'password';

const NOTICES: Record<string, string> = {
    replaced: 'Your account was opened on another browser, so it was signed out here. An account can be open on one browser and one phone at a time.',
    phone: 'This browser was signed out from your phone.',
    deleted: 'Your account is closed and you have been signed out. Your institution keeps a record of it; if you want it back, ask your school\'s ICT unit to restore it.',
    expired: 'Your session ended, so you were signed out to keep your account safe. Please sign in again.',
};

/**
 * Two ways in. "Link with your phone": scan the code with the SOS Connect app (like WhatsApp Web; the phone is the
 * main device). "Password": the same details as the school portal; admin accounts always use this.
 * There is no list or search of schools here, and a failed sign-in never says why.
 */
export default function Login() {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const notice = ['replaced', 'phone', 'deleted', 'expired'].find((k) => params.has(k));
    const [mode, setModeState] = useState<Mode>(() => {
        try { return (localStorage.getItem('sos.loginMode') as Mode) || 'phone'; } catch { return 'phone'; }
    });
    const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem('sos.loginMode', m); } catch { /* private mode */ } };

    return (
        <AuthShell>
            <Head title="Sign in" />
            {notice && <p role="alert" className="mb-5 rounded-xl bg-amber/20 px-3 py-2.5 text-sm text-ink">{NOTICES[notice]}</p>}

            <h1 className="text-2xl font-bold">Sign in</h1>
            <div role="tablist" aria-label="How to sign in" className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-mist p-1 text-sm font-semibold">
                <button role="tab" aria-selected={mode === 'phone'} onClick={() => setMode('phone')}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition ${mode === 'phone' ? 'bg-white text-grove shadow-sm' : 'text-muted hover:text-ink'}`}>
                    <Smartphone size={16} />Link with phone
                </button>
                <button role="tab" aria-selected={mode === 'password'} onClick={() => setMode('password')}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition ${mode === 'password' ? 'bg-white text-grove shadow-sm' : 'text-muted hover:text-ink'}`}>
                    <KeyRound size={16} />Password
                </button>
            </div>

            {mode === 'phone' ? <LinkWithPhone onUsePassword={() => setMode('password')} /> : <PasswordForm />}

            <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-5 text-sm">
                <Link href="/register-institution" className="font-medium text-leaf">Register an institution</Link>
                <Link href="/legal" className="font-medium text-muted hover:text-ink">Terms and privacy</Link>
            </div>
        </AuthShell>
    );
}

function PasswordForm() {
    const form = useForm({ identifier: '', password: '' });
    return (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); form.post('/login', { onSuccess: () => signedIn(), onFinish: () => form.reset('password') }); }}>
            <p className="text-[15px] text-muted">Use the same details as your school portal.</p>
            <div>
                <label className="label" htmlFor="login-id">Matric number, or staff email or staff number</label>
                <input id="login-id" className="input py-3" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false}
                    value={form.data.identifier} onChange={(e) => form.setData('identifier', e.target.value)} />
            </div>
            <div>
                <label className="label" htmlFor="login-pass">Password</label>
                <input id="login-pass" className="input py-3" type="password" autoComplete="current-password" value={form.data.password} onChange={(e) => form.setData('password', e.target.value)} />
            </div>
            {form.errors.identifier && <p className="rounded-xl bg-sos/8 px-3 py-2 text-sm text-sos">{form.errors.identifier}</p>}
            <button className="btn-primary w-full py-3 text-[15px]" disabled={form.processing}>{form.processing ? 'Signing in…' : 'Sign in'}</button>
            <p className="text-sm text-muted">Forgot your password? Reset it on your school portal.</p>
        </form>
    );
}

function xsrf(): string {
    const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}
const headers = () => ({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf() });

/** Shows a QR code, refreshes it every minute, and signs in as soon as the phone approves it. */
function LinkWithPhone({ onUsePassword }: { onUsePassword: () => void }) {
    const [svg, setSvg] = useState<string | null>(null);
    const [state, setState] = useState<'loading' | 'waiting' | 'paused' | 'linked' | 'error'>('loading');
    const code = useRef<string | null>(null);
    const key = useRef<string>('');
    const rounds = useRef(0);

    const fresh = async () => {
        setState('loading');
        try {
            const res = await fetch('/link', { method: 'POST', credentials: 'same-origin', headers: headers() });
            if (!res.ok) throw new Error(String(res.status));
            const r = await res.json() as { code: string; key: string; qr: string };
            code.current = r.code;
            key.current = r.key;
            setSvg(await QRCode.toString(r.qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0e3b2e', light: '#ffffff' } }));
            setState('waiting');
        } catch { setState('error'); }
    };

    useEffect(() => { fresh(); }, []);

    // Ask every two seconds whether the phone has approved. New code when this one runs out (five times, then pause).
    useEffect(() => {
        if (state !== 'waiting') return;
        const t = window.setInterval(async () => {
            if (!code.current || document.visibilityState === 'hidden') return;
            try {
                const res = await fetch(`/link/${code.current}`, { credentials: 'same-origin', headers: { ...headers(), 'X-Link-Key': key.current } });
                if (res.redirected || res.status === 409) { window.location.href = '/chats'; return; }
                const r = await res.json() as { status: string; redirect?: string };
                if (r.status === 'linked') {
                    setState('linked');
                    signedIn();
                    window.location.href = r.redirect ?? '/chats';
                } else if (r.status === 'expired') {
                    rounds.current += 1;
                    if (rounds.current >= 5) setState('paused'); else fresh();
                }
            } catch { /* offline for a moment: keep trying */ }
        }, 2000);
        return () => window.clearInterval(t);
    }, [state]);

    return (
        <div className="mt-6">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
                <div className="relative grid size-[220px] shrink-0 place-items-center rounded-2xl border border-line bg-white p-4">
                    {svg && <div aria-label="QR code to scan with the SOS Connect app" role="img" className={`size-full transition ${state === 'waiting' ? '' : 'opacity-15 blur-[2px]'}`} dangerouslySetInnerHTML={{ __html: svg }} />}
                    {state === 'loading' && <span className="absolute size-8 animate-spin rounded-full border-[3px] border-mist border-t-leaf" aria-label="Loading" />}
                    {state === 'linked' && <span className="absolute text-sm font-semibold text-grove">Signing in…</span>}
                    {(state === 'paused' || state === 'error') && (
                        <button onClick={() => { rounds.current = 0; fresh(); }} className="absolute flex flex-col items-center gap-2 rounded-full bg-leaf px-5 py-4 text-sm font-semibold text-white shadow">
                            <RefreshCw size={20} />{state === 'error' ? 'Try again' : 'New code'}
                        </button>
                    )}
                </div>
                <ol className="space-y-3 text-[15px] text-ink">
                    <li><span className="font-semibold text-grove">1.</span> Open SOS Connect on your phone.</li>
                    <li><span className="font-semibold text-grove">2.</span> Go to <strong>Settings</strong>, then <strong>Linked devices</strong>.</li>
                    <li><span className="font-semibold text-grove">3.</span> Tap <strong>Link a web browser</strong> and point your phone at this code.</li>
                </ol>
            </div>
            <p className="mt-5 text-sm text-muted">Your account can be open on one phone and one browser at a time. Admin accounts sign in with a <button className="font-medium text-leaf underline" onClick={onUsePassword}>password</button>.</p>
        </div>
    );
}
