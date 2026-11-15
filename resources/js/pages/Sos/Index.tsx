import { Head, usePage } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { MapPin, Phone, Radio, Siren } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { EmptyState, Modal, PageBody, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { getEcho } from '@/lib/echo';
import { listenUser, onChange } from '@/lib/live';
import type { SharedProps, SosAlert } from '@/types';

const ACTIONS: [string, string][] = [['acknowledged', 'Acknowledge'], ['on_my_way', 'On my way'], ['arrived', 'Arrived'], ['resolved', 'Resolved'], ['false_alarm', 'False alarm']];
const OPEN = ['open', 'acknowledged', 'responding'];
const CATEGORY: Record<string, string> = { medical: 'Medical', security: 'Security threat', fire: 'Fire', harassment: 'Harassment or assault', accident: 'Accident', other: 'Other' };
const STATUS: Record<string, { label: string; tone: string }> = {
    open: { label: 'Waiting for a responder', tone: 'bg-sos text-white' },
    acknowledged: { label: 'Acknowledged', tone: 'bg-amber/25 text-[#7a4d0b]' },
    responding: { label: 'Responder on the way', tone: 'bg-amber/25 text-[#7a4d0b]' },
    resolved: { label: 'Resolved', tone: 'bg-mint text-grove' },
    false_alarm: { label: 'False alarm', tone: 'bg-mist text-muted' },
    cancelled: { label: 'Cancelled', tone: 'bg-mist text-muted' },
};
const ACTION_LABEL: Record<string, string> = { acknowledged: 'acknowledged', on_my_way: 'is on the way', arrived: 'arrived', resolved: 'resolved it', false_alarm: 'marked it a false alarm', cancelled: 'cancelled it' };

/** Members see their own alerts; responders see a live console of every alert in the institution. */
export default function Sos() {
    const { auth, institution, reverb } = usePage<SharedProps>().props;
    const responder = auth!.permissions.includes('sos.view');
    const canRespond = auth!.permissions.includes('sos.respond');
    const [alerts, setAlerts] = useState<SosAlert[]>([]);
    const [onlyOpen, setOnlyOpen] = useState(responder);
    const [closing, setClosing] = useState<{ alert: SosAlert; action: string } | null>(null);
    const [note, setNote] = useState('');

    const load = () => api<{ alerts: SosAlert[] }>(`/sos${onlyOpen ? '?open=1' : ''}`).then((r) => setAlerts(r.alerts));
    useEffect(() => { load(); }, [onlyOpen]);

    useEffect(() => {
        const upsert = (a: SosAlert) => setAlerts((prev) => [a, ...prev.filter((x) => x.uuid !== a.uuid)]);
        const raised = (a: SosAlert) => { upsert(a); if (responder) beep(); };
        // My own alerts arrive on my personal channel (shared with calls, so it is never left here).
        const offs = [listenUser('sos.raised', raised), listenUser('sos.updated', upsert)];
        const echo = getEcho(reverb);
        const desk = responder ? `institution.${institution!.id}.responders` : null;
        if (echo && desk) echo.private(desk).listen('.sos.raised', raised).listen('.sos.updated', upsert);
        // Without the websocket: reload when anything changes, and beep for alerts we haven't seen.
        const offChange = onChange('sos', () => {
            api<{ alerts: SosAlert[] }>(`/sos${onlyOpenRef.current ? '?open=1' : ''}`).then((r) => {
                setAlerts((prev) => {
                    const known = new Set(prev.map((x) => x.uuid));
                    if (responder && r.alerts.some((a) => !known.has(a.uuid) && a.status === 'open')) beep();
                    return r.alerts;
                });
            }).catch(() => {});
        });
        return () => { offs.forEach((f) => f()); offChange(); if (echo && desk) echo.leave(desk); };
    }, []);
    const onlyOpenRef = useRef(onlyOpen);
    onlyOpenRef.current = onlyOpen;

    const respond = async (a: SosAlert, action: string, text?: string) => {
        const r = await api<{ alert: SosAlert }>(`/sos/${a.id}/respond`, { body: { action, note: text || undefined } });
        setAlerts((prev) => prev.map((x) => (x.uuid === a.uuid ? r.alert : x)));
    };
    const pick = (a: SosAlert, action: string) => {
        if (action === 'resolved' || action === 'false_alarm') { setNote(''); setClosing({ alert: a, action }); }
        else respond(a, action);
    };

    const openCount = alerts.filter((a) => OPEN.includes(a.status)).length;

    return (
        <AppLayout title={responder ? 'SOS alerts' : 'My alerts'}>
            <Head title="Alerts" />
            <PageHeader
                title={responder ? 'SOS alerts' : 'My alerts'}
                description={responder
                    ? 'Every SOS raised in your institution, newest first. Acknowledge quickly so the person knows help is coming.'
                    : 'Alerts you have sent and what responders have done about them.'}
                actions={responder && (
                    <div className="flex rounded-full bg-white p-1 text-sm font-medium">
                        <button className={`rounded-full px-3 py-1.5 ${onlyOpen ? 'bg-grove text-white' : 'text-muted'}`} onClick={() => setOnlyOpen(true)}>Open{onlyOpen && openCount ? ` (${openCount})` : ''}</button>
                        <button className={`rounded-full px-3 py-1.5 ${!onlyOpen ? 'bg-grove text-white' : 'text-muted'}`} onClick={() => setOnlyOpen(false)}>All</button>
                    </div>
                )}
            />
            <PageBody>
                {alerts.length === 0 && (
                    <EmptyState icon={<Siren size={26} />} title={responder ? 'No open alerts' : "You haven't sent any alerts"}>
                        {responder ? 'New alerts appear here and make a sound.' : 'If you ever need help, press the red SOS button. Responders are alerted straight away.'}
                    </EmptyState>
                )}
                <div className="space-y-3">
                    {alerts.map((a) => {
                        const live = OPEN.includes(a.status);
                        const st = STATUS[a.status] ?? { label: a.status, tone: 'bg-mist text-muted' };
                        return (
                            <article key={a.uuid} className={`overflow-hidden rounded-2xl bg-white ${live ? 'ring-2 ring-sos' : 'border border-line'}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-lg font-bold">{CATEGORY[a.category] ?? a.category}</h2>
                                            <span className={`pill ${st.tone}`}>{st.label}</span>
                                        </div>
                                        {a.user && (
                                            <p className="mt-1 text-[15px]">
                                                <strong className="font-semibold">{a.user.name}</strong>
                                                {[a.user.identifier, a.user.department].filter(Boolean).length > 0 && <span className="text-muted">, {[a.user.identifier, a.user.department].filter(Boolean).join(', ')}</span>}
                                                {a.user.residence && <span className="block text-[13px] font-medium text-ink">Lives in {a.user.residence}</span>}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right text-sm text-muted">
                                        <div>{new Date(a.raised_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                                        {a.via !== 'online' && <div className="mt-0.5 inline-flex items-center gap-1"><Radio size={14} />came in over the offline network</div>}
                                    </div>
                                </div>

                                <div className="space-y-2 px-4 pb-3 text-[15px]">
                                    {(a.location_label || a.lat !== null) && (
                                        <div className="flex items-start gap-2">
                                            <MapPin size={18} className="mt-0.5 shrink-0 text-sos" />
                                            <div>
                                                {a.location_label && <div>{a.location_label}</div>}
                                                {a.lat !== null && a.lng !== null && (
                                                    <a className="text-sm font-medium text-leaf underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=18/${a.lat}/${a.lng}`}>
                                                        Open map{a.accuracy_m ? `, accurate to about ${a.accuracy_m} m` : ''}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {a.message && <p className="rounded-xl bg-mist px-3 py-2">{a.message}</p>}
                                    {a.user?.phone && responder && (
                                        <a className="btn-outline" href={`tel:${a.user.phone}`}><Phone size={16} />Call {a.user.phone}</a>
                                    )}
                                </div>

                                {a.responses.length > 0 && (
                                    <ol className="space-y-1 border-t border-line px-4 py-3 text-sm">
                                        {a.responses.map((r, i) => (
                                            <li key={i} className="flex gap-3">
                                                <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-muted">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span><strong className="font-semibold">{r.by}</strong> {ACTION_LABEL[r.action] ?? r.action.replace('_', ' ')}{r.note && <span className="text-muted">: {r.note}</span>}</span>
                                            </li>
                                        ))}
                                    </ol>
                                )}

                                {live && (
                                    <div className="flex flex-wrap gap-2 border-t border-line bg-mist/50 px-4 py-3">
                                        {canRespond && a.user?.id !== auth!.user.id
                                            ? ACTIONS.map(([v, l], i) => <button key={v} className={i === 0 && a.status === 'open' ? 'btn-danger' : 'btn-outline'} onClick={() => pick(a, v)}>{l}</button>)
                                            : (!a.user || a.user.id === auth!.user.id) && <button className="btn-outline" onClick={() => respond(a, 'cancelled')}>I'm safe now, cancel the alert</button>}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            </PageBody>

            {closing && (
                <Modal title={closing.action === 'resolved' ? 'Mark as resolved' : 'Mark as a false alarm'} onClose={() => setClosing(null)}>
                    <label className="label" htmlFor="close-note">Note for the incident record <span className="font-normal text-muted">(optional)</span></label>
                    <textarea id="close-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder={closing.action === 'resolved' ? 'Student taken to the health centre, stable.' : 'Pressed by mistake, confirmed by phone.'} />
                    <div className="mt-4 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setClosing(null)}>Back</button>
                        <button className="btn-primary" onClick={async () => { await respond(closing.alert, closing.action, note); setClosing(null); }}>
                            {closing.action === 'resolved' ? 'Mark resolved' : 'Mark false alarm'}
                        </button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}

function beep() {
    try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        o.frequency.value = 880;
        o.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.6);
    } catch { /* autoplay blocked */ }
}
