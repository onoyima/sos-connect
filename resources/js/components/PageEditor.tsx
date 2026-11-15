import { useForm } from '@inertiajs/react';
import { useEffect, useState } from 'react';

type Props = {
    kind: 'help' | 'design'; slug?: string; initial: { title: string; body: string; audience: string; position?: number };
    audiences?: string[]; onCancel: () => void;
};

const xsrf = () => decodeURIComponent(document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1] ?? '');

/** Markdown editor with a live preview (rendered by the server, the same way readers see it). */
export function PageEditor({ kind, slug, initial, audiences = [], onCancel }: Props) {
    const form = useForm({ title: initial.title, body: initial.body, audience: initial.audience, position: initial.position ?? null as number | null });
    const [preview, setPreview] = useState('');
    const [tab, setTab] = useState<'write' | 'preview'>('write');
    useEffect(() => {
        const t = window.setTimeout(() => {
            fetch('/admin/pages/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf() }, body: JSON.stringify({ body: form.data.body }) })
                .then((r) => r.json()).then((r: { html: string }) => setPreview(r.html)).catch(() => {});
        }, 400);
        return () => window.clearTimeout(t);
    }, [form.data.body]);
    const save = (e: React.FormEvent) => { e.preventDefault(); form.post(`/admin/pages/${kind}${slug ? `/${slug}` : ''}`, { preserveScroll: true }); };
    const label = { everyone: 'Everyone', students: 'Students', staff: 'Staff', admins: 'Admins only' } as Record<string, string>;
    return (
        <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div><label className="label" htmlFor="pg-title">Title</label><input id="pg-title" className="input" value={form.data.title} onChange={(e) => form.setData('title', e.target.value)} /></div>
                {kind === 'help' && <div><label className="label" htmlFor="pg-aud">Who can read it</label>
                    <select id="pg-aud" className="input" value={form.data.audience} onChange={(e) => form.setData('audience', e.target.value)}>{audiences.map((a) => <option key={a} value={a}>{label[a] ?? a}</option>)}</select></div>}
                {kind === 'help' && <div><label className="label" htmlFor="pg-pos">Order</label><input id="pg-pos" type="number" className="input w-24" value={form.data.position ?? ''} onChange={(e) => form.setData('position', e.target.value === '' ? null : Number(e.target.value))} /></div>}
            </div>
            <div className="flex gap-1 rounded-full bg-mist p-1 text-sm font-semibold lg:hidden" role="tablist">
                {(['write', 'preview'] as const).map((t) => <button type="button" key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-full py-1.5 ${tab === t ? 'bg-white text-grove' : 'text-muted'}`}>{t === 'write' ? 'Write' : 'Preview'}</button>)}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
                <div className={tab === 'preview' ? 'hidden lg:block' : ''}>
                    <textarea aria-label="Page text (Markdown)" className="input min-h-[60dvh] font-mono text-[13px] leading-relaxed" value={form.data.body} onChange={(e) => form.setData('body', e.target.value)} />
                    <p className="mt-1 text-xs text-muted">Markdown: <code>## Heading</code>, <code>**bold**</code>, <code>* list</code>, <code>[link](https://…)</code>, tables with <code>|</code>.</p>
                </div>
                <div className={`doc min-h-[60dvh] overflow-auto rounded-2xl border border-line bg-white p-5 ${tab === 'write' ? 'hidden lg:block' : ''}`} dangerouslySetInnerHTML={{ __html: preview }} />
            </div>
            {Object.values(form.errors)[0] && <p className="text-sm text-sos">{Object.values(form.errors)[0]}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={form.processing}>{form.processing ? 'Saving…' : 'Save'}</button></div>
        </form>
    );
}
