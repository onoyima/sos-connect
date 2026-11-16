import { router } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BellOff, MapPin, Phone, Siren, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import { listenUser } from '@/lib/live';
import { askForSosAlerts, closeSosNote, flashTitle, notifySos, soundBlocked, startSiren, stopSiren, stopTitle, unlockSound } from '@/lib/siren';

type Alarm = {
    id: number; category: string; message: string | null; status: string; raised_at: string | null; location_label: string | null;
    lat: number | null; lng: number | null; accuracy_m: number | null; via?: string; escalated?: boolean;
    user: { name: string | null; identifier: string | null; phone: string | null; department: string | null; residence: string | null };
    takenBy?: string | null;
};
type ListedAlert = Omit<Alarm, 'user'> & { user: Alarm['user'] | null; responses?: { action: string; by: string | null }[] };

const CATEGORY: Record<string, string> = { medical: 'Medical emergency', security: 'Security threat', fire: 'Fire', harassment: 'Harassment', accident: 'Accident', other: 'Emergency' };
const SILENCED = 'sos.silenced';
const silenced = (): number[] => { try { return JSON.parse(sessionStorage.getItem(SILENCED) ?? '[]'); } catch { return []; } };
const silence = (id: number) => { try { sessionStorage.setItem(SILENCED, JSON.stringify([...silenced(), id].slice(-50))); } catch { /* private mode */ } };
const ago = (iso: string | null) => {
    if (!iso) return '';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * The SOS alarm for responders (campus security, wardens, admins…): a new alert takes over the screen with a siren,
 * vibration, a flashing tab title and a desktop notification, wherever they are in the app. It stops when they
 * respond, open it or silence it, or when someone else responds (they're told who).
 */
export function SosAlarm() {
    const [alarms, setAlarms] = useState<Alarm[]>([]);
    const [blocked, setBlocked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [, tick] = useState(0);
    const alarmsRef = useRef<Alarm[]>([]);
    alarmsRef.current = alarms;
    const top = alarms[0];
    const ringing = !!top && !top.takenBy;

    const add = useCallback((a: Alarm) => {
        if (silenced().includes(a.id) && !a.escalated) return;
        setAlarms((list) => [a, ...list.filter((x) => x.id !== a.id)]);
    }, []);
    const remove = useCallback((id: number) => {
        closeSosNote(id);
        setAlarms((list) => list.filter((x) => x.id !== id));
    }, []);

    // New alerts, and other responders taking them.
    useEffect(() => {
        askForSosAlerts();
        const off1 = listenUser('sos.alarm', (a: Alarm) => add(a));
        const off2 = listenUser('sos.update', (u: { id: number; status: string; action: string; by: string }) => {
            if (!alarmsRef.current.some((a) => a.id === u.id)) return;
            if (['resolved', 'false_alarm', 'cancelled'].includes(u.status)) { remove(u.id); return; }
            setAlarms((list) => list.map((a) => (a.id === u.id ? { ...a, status: u.status, takenBy: u.by } : a)));
            window.setTimeout(() => remove(u.id), 8000); // shown briefly, then gone: someone is on it
        });
        // Opened the site while an alert is still unanswered: it alarms now.
        api<{ alerts: ListedAlert[]; responder: boolean }>('/sos?open=1').then((r) => {
            if (!r.responder) return;
            r.alerts.filter((a) => a.status === 'open' && a.user).forEach((a) => add({ ...a, user: a.user! }));
        }).catch(() => {});
        const t = window.setInterval(() => tick((n) => n + 1), 30_000); // keeps "2 min ago" fresh
        return () => { off1(); off2(); window.clearInterval(t); };
    }, [add, remove]);

    // Sound, title and desktop notification follow what is on screen.
    useEffect(() => {
        if (ringing) {
            startSiren();
            flashTitle(`🚨 SOS: ${top.user.name ?? 'Someone'} needs help`);
            notifySos(top.id, `SOS: ${CATEGORY[top.category] ?? 'Emergency'}`, `${top.user.name ?? 'Someone'} needs help${top.location_label ? ` at ${top.location_label}` : ''}.`, () => {});
            const check = window.setTimeout(() => setBlocked(soundBlocked()), 600);
            return () => window.clearTimeout(check);
        }
        stopSiren();
        stopTitle();
        return undefined;
    }, [ringing, top?.id]);
    useEffect(() => () => { stopSiren(); stopTitle(); }, []);

    if (!top) return null;

    const respond = async () => {
        setBusy(true);
        try {
            await api(`/sos/${top.id}/respond`, { body: { action: 'acknowledged' } });
            remove(top.id);
            router.visit('/sos');
        } catch (e) { alert((e as Error).message); }
        setBusy(false);
    };
    const open = () => { silence(top.id); remove(top.id); router.visit('/sos'); };
    const mute = () => { silence(top.id); remove(top.id); };
    const map = top.lat !== null && top.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${top.lat},${top.lng}` : null;

    return (
        <div className="fixed inset-0 z-[80] flex overflow-y-auto bg-sos p-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+16px)] text-white" role="alertdialog" aria-modal aria-labelledby="sos-alarm-title"
            onClick={() => { unlockSound(); setBlocked(false); }}>
            <div className="m-auto w-full max-w-md">
                <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">
                        <span className="size-2.5 animate-ping rounded-full bg-white" />{top.escalated ? 'Still no response' : 'SOS alert'}{alarms.length > 1 ? ` · ${alarms.length} open` : ''}
                    </span>
                    <button onClick={mute} className="rounded-full p-2 hover:bg-white/15" aria-label="Silence this alarm"><X size={22} /></button>
                </div>

                <div className="mt-4 flex justify-center sm:mt-6">
                    <span className="relative flex size-20 items-center sm:size-24 justify-center rounded-full bg-white text-sos shadow-2xl">
                        {ringing && <span className="absolute inset-0 animate-ping rounded-full bg-white/60" />}
                        <Siren size={46} className="relative" />
                    </span>
                </div>
                <h1 id="sos-alarm-title" className="mt-5 text-center text-3xl leading-tight font-extrabold text-white">{CATEGORY[top.category] ?? 'Emergency'}</h1>
                <p className="mt-1 text-center text-lg"><strong>{top.user.name ?? 'Someone'}</strong> needs help · {ago(top.raised_at)}</p>
                {top.message && <p className="mt-3 rounded-2xl bg-white/12 px-4 py-3 text-center text-[15px] break-words">“{top.message}”</p>}

                <div className="mt-4 space-y-2 rounded-2xl bg-white/12 p-4 text-[15px]">
                    <p className="flex items-start gap-2"><MapPin size={18} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{top.location_label ?? (map ? 'Location attached' : 'No location shared')}{top.accuracy_m ? ` (within ${top.accuracy_m} m)` : ''}
                            {map && <> · <a href={map} target="_blank" rel="noopener noreferrer" className="font-semibold underline" onClick={(e) => e.stopPropagation()}>Open map</a></>}</span></p>
                    {(top.user.residence || top.user.department) && <p className="flex items-start gap-2"><UserRound size={18} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{[top.user.identifier, top.user.department, top.user.residence].filter(Boolean).join(' · ')}</span></p>}
                    {top.user.phone && <p className="flex items-center gap-2"><Phone size={18} className="shrink-0" /><a href={`tel:${top.user.phone}`} className="font-semibold underline" onClick={(e) => e.stopPropagation()}>{top.user.phone}</a></p>}
                </div>

                {top.takenBy ? (
                    <p className="mt-5 rounded-2xl bg-white px-4 py-3 text-center font-semibold text-sos">{top.takenBy} is responding.</p>
                ) : (
                    <div className="mt-5 grid gap-2">
                        <button onClick={respond} disabled={busy} className="rounded-full bg-white py-4 text-lg font-extrabold text-sos shadow-lg hover:bg-white/90 disabled:opacity-70">
                            {busy ? 'Telling them…' : "I'm responding"}
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={open} className="rounded-full border-2 border-white/70 py-3 font-semibold hover:bg-white/10">Open alert</button>
                            <button onClick={mute} className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white/70 py-3 font-semibold hover:bg-white/10"><BellOff size={18} />Silence</button>
                        </div>
                    </div>
                )}
                {blocked && ringing && <p className="mt-3 text-center text-sm text-white/85">Tap anywhere to hear the alarm.</p>}
            </div>
        </div>
    );
}
