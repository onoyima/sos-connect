import { Head, Link } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/** Legal pages are public (no sign-in), so they get a simple frame instead of the app layout. */
export function LegalFrame({ children, back = false }: { children: ReactNode; back?: boolean }) {
    return (
        <div className="min-h-full">
            <header className="bg-grove text-white">
                <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
                    <Link href="/" className="font-semibold">SOS Connect</Link>
                    {back && <Link href="/legal" className="ml-auto inline-flex items-center gap-1.5 text-sm text-white/75 hover:text-white"><ArrowLeft size={16} />All policies</Link>}
                </div>
            </header>
            <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>
        </div>
    );
}

/** html is produced server-side by Str::markdown with raw HTML escaped, from files in docs/legal. */
export default function LegalShow({ title, html }: { title: string; html: string }) {
    return (
        <LegalFrame back>
            <Head title={title} />
            <article className="prose-legal rounded-2xl bg-white px-6 py-8 md:px-10" dangerouslySetInnerHTML={{ __html: html }} />
        </LegalFrame>
    );
}
