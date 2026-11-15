import { Head, router, useForm } from '@inertiajs/react';
import { Megaphone, MessageSquareWarning, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { AudienceSelect, audienceKey } from '@/components/AudienceSelect';
import { EmptyState, Modal, PageBody, PageHeader, when } from '@/components/ui';
import type { AudienceOption } from '@/types';

type Item = {
    id: number; kind: 'popup' | 'marquee'; style: 'info' | 'urgent' | 'celebration'; title: string | null; body: string; link_url: string | null; link_label: string | null;
    audience: AudienceOption['value'] & { level?: number }; audience_label: string; state: 'live' | 'paused' | 'scheduled' | 'ended';
    starts_at: string | null; ends_at: string | null; by: string | null; created_at: string | null; can_edit: boolean;
};

const STATE: Record<Item['state'], string> = { live: 'bg-mint text-grove', paused: 'bg-amber/25 text-[#7a4d0b]', scheduled: 'bg-mist text-muted', ended: 'bg-mist text-muted' };
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

/** Admin > Pop-ups and marquee. */
export default function Broadcasts({ items, audiences }: { items: Item[]; audiences: AudienceOption[] }) {
    const [editing, setEditing] = useState<Item | 'popup' | 'marquee' | null>(null);
    return (
        <AppLayout title="Pop-ups and marquee">
            <Head title="Pop-ups and marquee" />
            <PageHeader title="Pop-ups and marquee"
                description="A pop-up appears every time someone opens SOS Connect, until you pause it. A marquee is a line of text sliding across the top of every screen; it never blocks chats or calls."
                actions={audiences.length > 0 && <>
                    <button className="btn-outline" onClick={() => setEditing('marquee')}><Plus size={16} />Marquee line</button>
                    <button className="btn-primary" onClick={() => setEditing('popup')}><Plus size={16} />Pop-up message</button>
                </>} />
            <PageBody narrow>
                {items.length === 0 ? <EmptyState icon={<Megaphone size={26} />} title="Nothing yet">Make a pop-up for something everyone must see, or a marquee line for gentle reminders.</EmptyState> : (
                    <div className="overflow-hidden rounded-2xl bg-white">
                        {items.map((b) => (
                            <div key={b.id} className="flex items-start gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                                <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${b.style === 'urgent' ? 'bg-sos/10 text-sos' : 'bg-mint text-leaf'}`}>
                                    {b.kind === 'popup' ? <MessageSquareWarning size={18} /> : <Megaphone size={18} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{b.title || (b.kind === 'popup' ? 'Pop-up' : 'Marquee')}</span>
                                        <span className={`pill ${STATE[b.state]}`}>{b.state}</span>
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-sm break-words">{b.body}</p>
                                    <p className="mt-1 text-xs text-muted">{b.kind === 'popup' ? 'Pop-up' : 'Marquee'} · to {b.audience_label.toLowerCase()} · {when(b.created_at)}{b.by ? ` by ${b.by}` : ''}{b.ends_at ? ` · ends ${new Date(b.ends_at).toLocaleString()}` : ''}</p>
                                </div>
                                {b.can_edit && (
                                    <div className="flex shrink-0">
                                        {b.state !== 'ended' && <button className="icon-btn" title={b.state === 'paused' ? 'Resume' : 'Pause'} aria-label={b.state === 'paused' ? 'Resume' : 'Pause'} onClick={() => router.post(`/admin/broadcasts/${b.id}/pause`, {}, { preserveScroll: true })}>{b.state === 'paused' ? <Play size={17} /> : <Pause size={17} />}</button>}
                                        <button className="icon-btn" aria-label="Edit" onClick={() => setEditing(b)}><Pencil size={17} /></button>
                                        <button className="icon-btn text-sos" aria-label="Delete" onClick={() => confirm('Delete this message?') && router.delete(`/admin/broadcasts/${b.id}`, { preserveScroll: true })}><Trash2 size={17} /></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </PageBody>
            {editing && <Editor item={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} audiences={audiences} onClose={() => setEditing(null)} />}
        </AppLayout>
    );
}

function Editor({ item, kind, audiences, onClose }: { item: Item | null; kind: 'popup' | 'marquee'; audiences: AudienceOption[]; onClose: () => void }) {
    const firstAudience = audiences[0] ? audienceKey(audiences[0].value) : '';
    const form = useForm({
        kind, style: item?.style ?? 'info', title: item?.title ?? '', body: item?.body ?? '', link_url: item?.link_url ?? '', link_label: item?.link_label ?? '',
        audienceKey: item ? audienceKey(item.audience) : firstAudience, level: item?.audience.level ? String(item.audience.level) : '',
        starts_at: local(item?.starts_at ?? null), ends_at: local(item?.ends_at ?? null),
    });
    const chosen = audiences.find((a) => audienceKey(a.value) === form.data.audienceKey)?.value;
    const studentsOnly = chosen && (chosen.type === 'students' || (chosen.type === 'unit' && chosen.who === 'students'));
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.transform((d) => ({
            kind: d.kind, style: d.style, title: d.title || null, body: d.body, link_url: d.link_url || null, link_label: d.link_label || null,
            audience: { ...(chosen ?? { type: 'all' }), level: studentsOnly && d.level ? Number(d.level) : undefined },
            starts_at: d.starts_at ? new Date(d.starts_at).toISOString() : null, ends_at: d.ends_at ? new Date(d.ends_at).toISOString() : null,
        }));
        const opts = { onSuccess: onClose, preserveScroll: true };
        item ? form.put(`/admin/broadcasts/${item.id}`, opts) : form.post('/admin/broadcasts', opts);
    };
    const err = Object.values(form.errors)[0];
    return (
        <Modal title={`${item ? 'Edit' : 'New'} ${kind === 'popup' ? 'pop-up message' : 'marquee line'}`} onClose={onClose} wide>
            <form className="space-y-3" onSubmit={submit}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="b-aud">Send to</label><AudienceSelect id="b-aud" options={audiences} value={form.data.audienceKey} onChange={(v) => form.setData('audienceKey', v)} /></div>
                    {studentsOnly
                        ? <div><label className="label" htmlFor="b-level">Level (optional)</label><select id="b-level" className="input" value={form.data.level} onChange={(e) => form.setData('level', e.target.value)}><option value="">All levels</option>{[100, 200, 300, 400, 500, 600, 700].map((l) => <option key={l} value={l}>{l} level</option>)}</select></div>
                        : <div><label className="label" htmlFor="b-style">Look</label><select id="b-style" className="input" value={form.data.style} onChange={(e) => form.setData('style', e.target.value as Item['style'])}><option value="info">Normal</option><option value="urgent">Urgent (red)</option><option value="celebration">Celebration</option></select></div>}
                </div>
                {studentsOnly && <div><label className="label" htmlFor="b-style2">Look</label><select id="b-style2" className="input" value={form.data.style} onChange={(e) => form.setData('style', e.target.value as Item['style'])}><option value="info">Normal</option><option value="urgent">Urgent (red)</option><option value="celebration">Celebration</option></select></div>}
                <div><label className="label" htmlFor="b-title">Title {kind === 'marquee' && '(optional)'}</label><input id="b-title" className="input" maxLength={160} value={form.data.title} onChange={(e) => form.setData('title', e.target.value)} /></div>
                <div>
                    <label className="label" htmlFor="b-body">Message</label>
                    <textarea id="b-body" className="input min-h-28" maxLength={kind === 'marquee' ? 300 : 2000} value={form.data.body} onChange={(e) => form.setData('body', e.target.value)} />
                    <p className="mt-1 text-xs text-muted">{form.data.body.length}/{kind === 'marquee' ? 300 : 2000}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="b-link">Link (optional)</label><input id="b-link" className="input" placeholder="https://… or /announcements" value={form.data.link_url} onChange={(e) => form.setData('link_url', e.target.value)} /></div>
                    <div><label className="label" htmlFor="b-linkl">Link text</label><input id="b-linkl" className="input" placeholder="Read more" value={form.data.link_label} onChange={(e) => form.setData('link_label', e.target.value)} /></div>
                    <div><label className="label" htmlFor="b-start">Start (optional)</label><input id="b-start" type="datetime-local" className="input" value={form.data.starts_at} onChange={(e) => form.setData('starts_at', e.target.value)} /></div>
                    <div><label className="label" htmlFor="b-end">End (optional)</label><input id="b-end" type="datetime-local" className="input" value={form.data.ends_at} onChange={(e) => form.setData('ends_at', e.target.value)} /></div>
                </div>
                {kind === 'popup' && <p className="rounded-xl bg-mist px-3 py-2 text-sm text-muted">Shown every time people in this audience open the app, until you pause it or it ends.</p>}
                {err && <p className="text-sm text-sos">{err}</p>}
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={form.processing || !form.data.body || !form.data.audienceKey}>{item ? 'Save' : 'Start now'}</button></div>
            </form>
        </Modal>
    );
}
