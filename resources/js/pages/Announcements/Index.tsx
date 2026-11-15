import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Megaphone, Pencil, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { AudienceSelect, audienceKey } from '@/components/AudienceSelect';
import { Avatar, EmptyState, Modal, PageBody, PageHeader, when } from '@/components/ui';
import { onChange } from '@/lib/live';
import { api } from '@/lib/api';
import type { AudienceOption } from '@/types';

type Item = {
    id: number; title: string; body: string; priority: string; audience: AudienceOption['value']; audience_label: string;
    author: { name: string; title: string | null } | null; published_at: string; can_edit: boolean; can_delete: boolean;
};
type Draft = { id?: number; title: string; body: string; priority: string; audience: string };

export default function Announcements() {
    const [items, setItems] = useState<Item[]>([]);
    const [audiences, setAudiences] = useState<AudienceOption[]>([]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Item | null>(null);

    const load = () => api<{ announcements: Item[]; audiences: AudienceOption[] }>('/announcements').then((r) => { setItems(r.announcements); setAudiences(r.audiences); });
    useEffect(() => { load(); }, []);
    useEffect(() => onChange('announcements', () => { load(); }), []);

    const blank = (): Draft => ({ title: '', body: '', priority: 'normal', audience: audiences[0] ? audienceKey(audiences[0].value) : '' });
    const save = async () => {
        if (!draft) return;
        const audience = audiences.find((a) => audienceKey(a.value) === draft.audience)?.value ?? JSON.parse(draft.audience || '{}');
        const body = { title: draft.title, body: draft.body, priority: draft.priority, audience };
        try {
            await api(draft.id ? `/announcements/${draft.id}` : '/announcements', { method: draft.id ? 'PUT' : 'POST', body });
            setDraft(null);
            setError(null);
            load();
        } catch (e) { setError((e as Error).message); }
    };

    return (
        <AppLayout title="Notices">
            <Head title="Notices" />
            <PageHeader
                title="Notices"
                description="Official announcements from your institution, faculty and department."
                actions={audiences.length > 0 && <button className="btn-primary" onClick={() => { setError(null); setDraft(blank()); }}>Post a notice</button>}
            />
            <PageBody narrow>
                {items.length === 0 && (
                    <EmptyState icon={<Megaphone size={26} />} title="No notices yet">
                        Announcements from the registry, your dean or your head of department will appear here.
                    </EmptyState>
                )}
                <div className="space-y-3">
                    {items.map((a) => (
                        <article key={a.id} className={`rounded-2xl bg-white p-5 ${a.priority === 'urgent' ? 'border-l-4 border-sos' : ''}`}>
                            <div className="flex items-center gap-3">
                                <Avatar name={a.author?.name ?? 'Institution'} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold">{a.author?.name ?? 'Institution'}</div>
                                    <div className="truncate text-xs text-muted">{[a.author?.title, when(a.published_at), `to ${a.audience_label.toLowerCase()}`].filter(Boolean).join(', ')}</div>
                                </div>
                                {a.priority === 'urgent' && <span className="pill bg-sos text-white">Urgent</span>}
                                {a.can_edit && <button className="icon-btn" aria-label="Edit notice" onClick={() => { setError(null); setDraft({ id: a.id, title: a.title, body: a.body, priority: a.priority, audience: audienceKey(a.audience) }); }}><Pencil size={17} /></button>}
                                {a.can_delete && <button className="icon-btn hover:text-sos" aria-label="Delete notice" onClick={() => setDeleting(a)}><Trash2 size={17} /></button>}
                            </div>
                            <h2 className="mt-3 text-lg font-bold">{a.title}</h2>
                            <p className="mt-1 max-w-[70ch] text-[15px] leading-7 whitespace-pre-wrap">{a.body}</p>
                        </article>
                    ))}
                </div>
            </PageBody>

            {draft && (
                <Modal title={draft.id ? 'Edit notice' : 'Post a notice'} onClose={() => setDraft(null)} wide>
                    <div className="space-y-3">
                        <div>
                            <label className="label" htmlFor="an-title">Title</label>
                            <input id="an-title" className="input" placeholder="Second semester exams timetable" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                        </div>
                        <div>
                            <label className="label" htmlFor="an-body">Notice</label>
                            <textarea id="an-body" className="input" rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className="label" htmlFor="an-aud">Send to</label>
                                <AudienceSelect id="an-aud" options={audiences} value={draft.audience} onChange={(v) => setDraft({ ...draft, audience: v })} />
                            </div>
                            <div>
                                <label className="label" htmlFor="an-pri">Priority</label>
                                <select id="an-pri" className="input" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                                    <option value="normal">Normal</option><option value="urgent">Urgent, notify everyone now</option>
                                </select>
                            </div>
                        </div>
                        <p className="text-sm text-muted">You can only send to the areas you look after.</p>
                        {error && <p className="text-sm text-sos">{error}</p>}
                        <button className="btn-primary w-full py-3" disabled={!draft.title || !draft.body || !draft.audience} onClick={save}>{draft.id ? 'Save changes' : 'Post notice'}</button>
                    </div>
                </Modal>
            )}

            {deleting && (
                <Modal title="Delete this notice?" onClose={() => setDeleting(null)}>
                    <p className="text-[15px]">"{deleting.title}" will be removed for everyone.</p>
                    <div className="mt-4 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setDeleting(null)}>Keep it</button>
                        <button className="btn-danger" onClick={async () => { await api(`/announcements/${deleting.id}`, { method: 'DELETE' }); setDeleting(null); load(); }}>Delete notice</button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}
