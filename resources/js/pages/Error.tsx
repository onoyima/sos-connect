import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Home, LogIn, RefreshCw } from 'lucide-react';
import { Mark } from '@/components/AuthShell';

type Props = { status: number; message?: string | null; signedIn?: boolean };

const TEXT: Record<number, [string, string]> = {
    403: ["You don't have access to this", 'Your role here does not include this page or action. If you think it should, ask an admin at your institution.'],
    404: ["We couldn't find that page", 'The link may be old, or the page may have moved or been removed.'],
    405: ["That didn't work", 'This page was opened in a way it does not support. Go back and try again.'],
    429: ['Too many tries', 'Please wait a minute, then try again.'],
    500: ['Something went wrong on our side', 'It has been logged. Please try again in a moment.'],
    502: ['The service is not responding', 'Please try again in a moment.'],
    503: ['Back soon', 'SOS Connect is being updated. Please try again in a few minutes. In an emergency, call your campus security or emergency services.'],
};

/** Every error has a way out: back, home, sign in, or try again. */
export default function ErrorPage({ status, message, signedIn = false }: Props) {
    const [title, body] = TEXT[status] ?? ['Something went wrong', 'Please try again.'];
    const canGoBack = typeof window !== 'undefined' && window.history.length > 1;

    return (
        <div className="flex min-h-full items-center justify-center bg-mist px-5 py-12">
            <Head title={title} />
            <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(14,59,46,0.08)]">
                <Link href="/" className="mx-auto mb-6 inline-flex"><Mark size={48} /></Link>
                <p className="text-sm font-semibold tracking-wider text-muted">ERROR {status}</p>
                <h1 className="mt-2 text-2xl font-bold text-grove">{title}</h1>
                <p className="mt-3 text-[15px] text-muted">{message || body}</p>
                <div className="mt-7 flex flex-wrap justify-center gap-2">
                    {canGoBack && <button className="btn-outline" onClick={() => window.history.back()}><ArrowLeft size={17} />Go back</button>}
                    {status >= 500 || status === 429
                        ? <button className="btn-outline" onClick={() => window.location.reload()}><RefreshCw size={17} />Try again</button>
                        : null}
                    {signedIn
                        ? <Link href="/chats" className="btn-primary"><Home size={17} />Home</Link>
                        : <Link href="/login" className="btn-primary"><LogIn size={17} />Sign in</Link>}
                </div>
            </div>
        </div>
    );
}
