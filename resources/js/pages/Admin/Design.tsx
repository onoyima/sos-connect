import { Head, router } from '@inertiajs/react';
import { FileText, Pencil, Printer, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { PageEditor } from '@/components/PageEditor';
import { when } from '@/components/ui';

type Page = { slug: string; title: string; html: string; toc: { id: string; text: string; level: number }[]; body: string | null; updated_at: string | null; editor: string | null; built_in: boolean; audience: string };

/** The system design document: architecture, development process, security. Admins only. */
export default function Design({ page, can_edit }: { page: Page; can_edit: boolean }) {
    const [editing, setEditing] = useState(false);
    return (
        <AppLayout title="Design document">
            <Head title="Design document" />
            <div className="scroll-area h-full">
                <div className="mx-auto flex max-w-6xl gap-8 px-4 py-6 md:px-8">
                    {!editing && (
                        <nav aria-label="Contents" className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-64 shrink-0 self-start overflow-y-auto lg:block print:hidden">
                            <p className="mb-2 text-xs font-semibold text-muted uppercase">Contents</p>
                            {page.toc.map((t) => <a key={t.id} href={`#${t.id}`} className={`block rounded-lg px-2 py-1 text-sm hover:bg-mist ${t.level === 3 ? 'pl-5 text-muted' : 'font-medium'}`}>{t.text}</a>)}
                        </nav>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
                            <span className="pill bg-mint text-grove"><FileText size={13} />Admins only</span>
                            <span className="flex-1" />
                            {!editing && <button className="btn-ghost" onClick={() => window.print()}><Printer size={16} />Print or save as PDF</button>}
                            {can_edit && !editing && <button className="btn-outline" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
                            {can_edit && !editing && page.built_in && <button className="icon-btn" title="Restore the original" aria-label="Restore the original" onClick={() => confirm('Put the document back to the original version?') && router.post(`/admin/pages/design/${page.slug}/reset`)}><RotateCcw size={17} /></button>}
                        </div>
                        {editing
                            ? <PageEditor kind="design" slug={page.slug} initial={{ title: page.title, body: page.body ?? '', audience: 'admins' }} onCancel={() => setEditing(false)} />
                            : <article className="doc rounded-2xl bg-white p-5 md:p-8" dangerouslySetInnerHTML={{ __html: page.html }} />}
                        {page.updated_at && !editing && <p className="mt-4 text-xs text-muted">Updated {when(page.updated_at)}{page.editor ? ` by ${page.editor}` : ''}</p>}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
