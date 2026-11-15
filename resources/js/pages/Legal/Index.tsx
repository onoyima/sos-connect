import { Head, Link } from '@inertiajs/react';
import { FileText } from 'lucide-react';
import { LegalFrame } from './Show';

export default function LegalIndex({ documents }: { documents: Record<string, string> }) {
    return (
        <LegalFrame>
            <Head title="Terms and policies" />
            <h1 className="text-3xl font-bold">Terms and policies</h1>
            <p className="mt-2 max-w-[60ch] text-[15px] text-muted">How SOS Connect works, what it does with your information, and the rules everyone agrees to.</p>
            <ul className="mt-6 overflow-hidden rounded-2xl bg-white">
                {Object.entries(documents).map(([slug, title]) => (
                    <li key={slug} className="border-b border-line/70 last:border-0">
                        <Link className="flex items-center gap-3 px-4 py-3.5 font-medium hover:bg-mist" href={`/legal/${slug}`}><FileText size={18} className="shrink-0 text-leaf" />{title}</Link>
                    </li>
                ))}
            </ul>
        </LegalFrame>
    );
}
