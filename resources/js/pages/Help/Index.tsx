import { Head, Link, router } from '@inertiajs/react';
import { BookOpen, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { PageEditor } from '@/components/PageEditor';
import { EmptyState, when } from '@/components/ui';

type Page = { slug: string; title: string; audience: string; position: number; html: string; body: string | null; updated_at: string | null; editor: string | null; built_in: boolean };
type Props = { pages: { slug: string; title: string; audience: string }[]; page: Page | null; can_edit: boolean; audiences: string[] };

/** Help: how to use SOS Connect. Admins can change, add or remove pages at any time. */
export default function Help({ pages, page, can_edit, audiences }: Props) {
    const [q, setQ] = useState('');
    const [mode, setMode] = useState<null | 'edit' | 'new'>(null);
    const list = q.trim() ? pages.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase())) : pages;
    const tag = { admins: 'Admins', staff: 'Staff', students: 'Students' } as Record<string, string>;
    return (
        <AppLayout title="Help">
            <Head title={page ? `${page.title} · Help` : 'Help'} />
            <div className="flex h-full min-h-0">
                <aside className={`w-full shrink-0 flex-col border-r border-line bg-white md:flex md:w-72 ${page && mode === null ? 'hidden' : 'flex'} ${mode ? 'md:hidden' : ''}`}>
                    <div className="flex items-center justify-between px-4 pt-4 pb-2">
                        <h1 className="flex items-center gap-2 text-xl font-bold"><BookOpen size={20} className="text-leaf" />Help</h1>
                        {can_edit && <button className="icon-btn" title="New page" aria-label="New help page" onClick={() => setMode('new')}><Plus size={20} /></button>}
                    </div>
                    <div className="px-4 pb-2"><div className="relative"><Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" /><input className="input rounded-full bg-mist pl-9" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
                    <nav className="scroll-area min-h-0 flex-1 px-2 pb-4">
                        {list.map((p) => (
                            <Link key={p.slug} href={`/help/${p.slug}`} preserveScroll onClick={() => setMode(null)}
                                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${page?.slug === p.slug ? 'bg-mint font-semibold text-grove' : 'hover:bg-mist'}`}>
                                <span className="min-w-0 flex-1">{p.title}</span>{tag[p.audience] && <span className="pill bg-mist text-[10px] text-muted">{tag[p.audience]}</span>}
                            </Link>
                        ))}
                    </nav>
                </aside>
                <main className={`scroll-area min-w-0 flex-1 ${!page && mode === null ? 'hidden md:block' : ''}`}>
                    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
                        {mode === 'new' ? (
                            <><h2 className="mb-4 text-xl font-bold">New help page</h2><PageEditor kind="help" initial={{ title: '', body: '', audience: 'everyone' }} audiences={audiences} onCancel={() => setMode(null)} /></>
                        ) : mode === 'edit' && page ? (
                            <><h2 className="mb-4 text-xl font-bold">Edit: {page.title}</h2><PageEditor kind="help" slug={page.slug} initial={{ title: page.title, body: page.body ?? '', audience: page.audience, position: page.position }} audiences={audiences} onCancel={() => setMode(null)} /></>
                        ) : page ? (
                            <article>
                                <Link href="/help" className="mb-3 inline-block text-sm text-leaf md:hidden">‹ All help</Link>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <h1 className="text-2xl font-bold">{page.title}</h1>
                                    {can_edit && (
                                        <div className="flex gap-1">
                                            <button className="btn-outline" onClick={() => setMode('edit')}><Pencil size={15} />Edit</button>
                                            {page.built_in && <button className="icon-btn" title="Restore the original" aria-label="Restore the original" onClick={() => confirm('Put this page back to the original version?') && router.post(`/admin/pages/help/${page.slug}/reset`)}><RotateCcw size={17} /></button>}
                                            <button className="icon-btn text-sos" aria-label="Delete page" onClick={() => confirm('Delete this help page?') && router.delete(`/admin/pages/help/${page.slug}`)}><Trash2 size={17} /></button>
                                        </div>
                                    )}
                                </div>
                                <div className="doc mt-4" dangerouslySetInnerHTML={{ __html: page.html }} />
                                {page.updated_at && <p className="mt-8 text-xs text-muted">Updated {when(page.updated_at)}{page.editor ? ` by ${page.editor}` : ''}</p>}
                            </article>
                        ) : <EmptyState icon={<BookOpen size={26} />} title="Pick a topic">Choose a help page on the left.</EmptyState>}
                    </div>
                </main>
            </div>
        </AppLayout>
    );
}
