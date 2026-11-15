import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { HeartHandshake, Phone, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { AudienceSelect, audienceKey } from '@/components/AudienceSelect';
import { EmptyState, Modal, PageBody, PageHeader } from '@/components/ui';
import { onChange } from '@/lib/live';
import { api } from '@/lib/api';
import type { AudienceOption } from '@/types';

type Check = { uuid: string; title: string; message: string; closes_at: string; my_answer: string | null; audience_label: string; can_see_results: boolean };
type Results = { safe: number; need_help: { name: string; identifier: string | null; phone: string | null; department: string | null; note: string | null; at: string }[] };

export default function Safety() {
    const [checks, setChecks] = useState<Check[]>([]);
    const [audiences, setAudiences] = useState<AudienceOption[]>([]);
    const canSend = audiences.length > 0;
    const [results, setResults] = useState<Record<string, Results>>({});
    const [draft, setDraft] = useState({ title: '', message: '', audience: '', hours: 12 });
    const [composing, setComposing] = useState(false);
    const [helpFor, setHelpFor] = useState<Check | null>(null);
    const [note, setNote] = useState('');

    const load = () => api<{ checks: Check[]; audiences: AudienceOption[] }>('/safety-checks').then((r) => {
        setChecks(r.checks);
        setAudiences(r.audiences);
        setDraft((d) => (d.audience || !r.audiences[0] ? d : { ...d, audience: audienceKey(r.audiences[0].value) }));
    });
    useEffect(() => { load(); }, []);
    useEffect(() => onChange('safety', () => { load(); }), []);

    const answer = async (c: Check, a: 'safe' | 'need_help', text = '') => {
        await api(`/safety-checks/${c.uuid}/respond`, { body: { answer: a, note: text } });
        load();
    };
    const send = async () => {
        const audience = audiences.find((a) => audienceKey(a.value) === draft.audience)?.value;
        await api('/safety-checks', { body: { title: draft.title, message: draft.message, hours: draft.hours, audience } });
        setDraft({ ...draft, title: '', message: '' });
        setComposing(false);
        load();
    };
    const showResults = async (uuid: string) => setResults({ ...results, [uuid]: await api<Results>(`/safety-checks/${uuid}/results`) });

    return (
        <AppLayout title="Safety checks">
            <Head title="Safety checks" />
            <PageHeader
                title="Safety checks"
                description="After an incident, your institution may ask whether you're safe. One tap tells them, so responders can focus on people who need help."
                actions={canSend && <button className="btn-danger" onClick={() => setComposing(true)}>Ask "Are you safe?"</button>}
            />
            <PageBody narrow>
                {checks.length === 0 && (
                    <EmptyState icon={<ShieldCheck size={26} />} title="No safety checks right now">
                        When one is sent, it appears here and at the top of every page.
                    </EmptyState>
                )}
                <div className="space-y-3">
                    {checks.map((c) => {
                        const r = results[c.uuid];
                        return (
                            <article key={c.uuid} className="rounded-2xl bg-white p-5">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <h2 className="text-lg font-bold">{c.title}</h2>
                                    <span className="text-sm text-muted">To {c.audience_label.toLowerCase()}, open until {new Date(c.closes_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p className="mt-1.5 text-[15px] whitespace-pre-wrap">{c.message}</p>
                                <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-sm">
                                    <button className={`btn py-3 ${c.my_answer === 'safe' ? 'bg-leaf text-white' : 'border border-line bg-white hover:bg-mint'}`} onClick={() => answer(c, 'safe')}>
                                        {c.my_answer === 'safe' ? "You're marked safe" : "I'm safe"}
                                    </button>
                                    <button className={`btn py-3 ${c.my_answer === 'need_help' ? 'bg-sos text-white' : 'border border-line bg-white text-sos hover:bg-sos/8'}`} onClick={() => { setNote(''); setHelpFor(c); }}>
                                        {c.my_answer === 'need_help' ? 'Help requested' : 'I need help'}
                                    </button>
                                </div>
                                {c.can_see_results && (
                                    <div className="mt-4 border-t border-line pt-3">
                                        {!r ? <button className="text-sm font-semibold text-leaf" onClick={() => showResults(c.uuid)}>See who has answered</button> : (
                                            <div className="text-sm">
                                                <div className="flex gap-4">
                                                    <span><strong className="text-lg text-leaf">{r.safe}</strong> safe</span>
                                                    <span><strong className="text-lg text-sos">{r.need_help.length}</strong> need help</span>
                                                    <button className="ml-auto font-semibold text-leaf" onClick={() => showResults(c.uuid)}>Refresh</button>
                                                </div>
                                                {r.need_help.length > 0 && (
                                                    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                                                        {r.need_help.map((n, i) => (
                                                            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                                                                <span className="font-semibold">{n.name}</span>
                                                                {n.identifier && <span className="text-muted">{n.identifier}</span>}
                                                                {n.note && <span className="w-full text-muted">{n.note}</span>}
                                                                {n.phone && <a className="font-semibold text-leaf" href={`tel:${n.phone}`}><Phone size={14} className="mr-1 inline" />{n.phone}</a>}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            </PageBody>

            {helpFor && (
                <Modal title="Tell responders what you need" onClose={() => setHelpFor(null)}>
                    <label className="label" htmlFor="help-note">Where are you, and what's wrong?</label>
                    <textarea id="help-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Trapped on 2nd floor of Hostel B, smoke in the corridor." />
                    <p className="mt-2 flex items-start gap-2 text-sm text-muted"><HeartHandshake size={16} className="mt-0.5 shrink-0" />Your name and phone number are shared with responders.</p>
                    <div className="mt-4 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setHelpFor(null)}>Back</button>
                        <button className="btn-danger" onClick={async () => { await answer(helpFor, 'need_help', note); setHelpFor(null); }}>Ask for help</button>
                    </div>
                </Modal>
            )}

            {composing && (
                <Modal title='Ask "Are you safe?"' onClose={() => setComposing(false)} wide>
                    <div className="space-y-3">
                        <div>
                            <label className="label" htmlFor="sc-title">Headline</label>
                            <input id="sc-title" className="input" placeholder="Fire at Hostel B" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                        </div>
                        <div>
                            <label className="label" htmlFor="sc-msg">What happened and what should people do?</label>
                            <textarea id="sc-msg" className="input" rows={4} placeholder="Leave the building by the nearest exit and gather at the sports field." value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="label" htmlFor="sc-aud">Send to</label>
                                <AudienceSelect id="sc-aud" options={audiences} value={draft.audience} onChange={(v) => setDraft({ ...draft, audience: v })} />
                            </div>
                            <div>
                                <label className="label" htmlFor="sc-hours">Keep open for (hours)</label>
                                <input id="sc-hours" className="input" type="number" min={1} max={72} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })} />
                            </div>
                        </div>
                        <button className="btn-danger w-full py-3" disabled={!draft.title || !draft.message} onClick={send}>Send safety check</button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}
