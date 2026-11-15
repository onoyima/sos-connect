import { usePage } from '@inertiajs/react';
import { useRef, useState } from 'react';
import { Car, Check, Flame, HandHelping, HeartPulse, MapPin, Phone, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api, uuid } from '@/lib/api';
import type { SharedProps } from '@/types';
import { Modal } from './ui';

const CATEGORIES = [
    { v: 'medical', l: 'Medical', icon: HeartPulse },
    { v: 'security', l: 'Security threat', icon: ShieldAlert },
    { v: 'fire', l: 'Fire', icon: Flame },
    { v: 'harassment', l: 'Harassment or assault', icon: HandHelping },
    { v: 'accident', l: 'Accident', icon: Car },
    { v: 'other', l: 'Something else', icon: TriangleAlert },
] as const;

const HOLD_MS = 1500;

/**
 * Web SOS (needs internet). Hold-to-confirm avoids accidental alerts. If the request fails, the dialog
 * falls back to phone numbers, because a browser cannot use the Bluetooth/Wi-Fi mesh.
 */
export function SosButton({ variant }: { variant: 'rail' | 'tab' }) {
    const { institution } = usePage<SharedProps>().props;
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState<string>('security');
    const [label, setLabel] = useState('');
    const [state, setState] = useState<'idle' | 'holding' | 'sending' | 'sent' | 'failed'>('idle');
    const holdTimer = useRef<number | null>(null);
    const clientId = useRef(uuid());

    const location = () => new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });

    const send = async () => {
        setState('sending');
        const pos = await location();
        try {
            await api('/sos', { body: {
                client_id: clientId.current, category, location_label: label || null,
                lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null, accuracy_m: pos ? Math.round(pos.coords.accuracy) : null,
                raised_at: new Date().toISOString(),
            } });
            setState('sent');
        } catch {
            setState('failed');
        }
    };

    const startHold = () => {
        if (state === 'sending') return;
        setState('holding');
        holdTimer.current = window.setTimeout(send, HOLD_MS);
    };
    const cancelHold = () => {
        if (holdTimer.current) window.clearTimeout(holdTimer.current);
        setState((s) => (s === 'holding' ? 'idle' : s));
    };
    const openDialog = () => { clientId.current = uuid(); setState('idle'); setOpen(true); };

    const trigger = variant === 'rail' ? (
        <button onClick={openDialog} aria-label="Send an SOS"
            className="flex size-14 flex-col items-center justify-center rounded-full bg-sos text-[13px] font-bold tracking-wide text-white shadow-[0_0_0_4px_rgba(214,40,57,0.25)] transition hover:bg-sos-dark">
            SOS
        </button>
    ) : (
        <button onClick={openDialog} aria-label="Send an SOS"
            className="-mt-5 flex size-14 items-center justify-center rounded-full border-4 border-white bg-sos text-[13px] font-bold tracking-wide text-white shadow-[0_4px_14px_rgba(214,40,57,0.45)]">
            SOS
        </button>
    );

    const callButtons = (
        <div className="grid gap-2 sm:grid-cols-2">
            {institution?.security_phone && (
                <a className="btn-outline justify-start py-3" href={`tel:${institution.security_phone}`}><Phone size={16} />Campus security, {institution.security_phone}</a>
            )}
            {(institution?.emergency_numbers ?? []).map((n) => (
                <a key={n} className="btn-outline justify-start py-3" href={`tel:${n}`}><Phone size={16} />National emergency, {n}</a>
            ))}
        </div>
    );

    return (
        <>
            {trigger}
            {open && (
                <Modal title={state === 'sent' ? 'Help is being alerted' : 'Send an SOS'} onClose={() => { cancelHold(); setOpen(false); }}>
                    {state === 'sent' ? (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 rounded-2xl bg-mint p-4 text-grove">
                                <Check className="mt-0.5 shrink-0" size={20} />
                                <p className="text-sm">Campus responders have your alert{label ? ` and your location note, "${label}"` : ''}. Their replies will appear under Alerts. Stay where you are if it's safe.</p>
                            </div>
                            <p className="text-sm text-muted">If you're in immediate danger, call as well:</p>
                            {callButtons}
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <p className="label">What's happening?</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {CATEGORIES.map(({ v, l, icon: Icon }) => (
                                        <button key={v} type="button" onClick={() => setCategory(v)} aria-pressed={category === v}
                                            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${category === v ? 'border-sos bg-sos/8 text-sos' : 'border-line text-ink hover:bg-mist'}`}>
                                            <Icon size={18} className="shrink-0" />{l}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="label" htmlFor="sos-where">Where are you? <span className="font-normal text-muted">(optional)</span></label>
                                <div className="relative">
                                    <MapPin size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                                    <input id="sos-where" className="input pl-10" placeholder="Hostel B, room 12" value={label} onChange={(e) => setLabel(e.target.value)} />
                                </div>
                                <p className="mt-1.5 text-xs text-muted">Your GPS location is added automatically if your browser allows it.</p>
                            </div>

                            <div className="flex flex-col items-center pt-1">
                                <button type="button"
                                    className={`relative flex size-32 items-center justify-center rounded-full bg-sos text-white transition-transform select-none active:scale-95 ${state === 'holding' ? 'holding' : ''}`}
                                    onPointerDown={startHold} onPointerUp={cancelHold} onPointerLeave={cancelHold} onContextMenu={(e) => e.preventDefault()}
                                    onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(); } }}
                                    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancelHold(); }}
                                    disabled={state === 'sending'} aria-label="Hold to send SOS">
                                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 128 128" aria-hidden>
                                        <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="6" />
                                        <circle className="sos-ring-fill" cx="64" cy="64" r="54" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
                                    </svg>
                                    <span className="relative text-2xl font-bold tracking-wide">{state === 'sending' ? '…' : 'SOS'}</span>
                                </button>
                                <p className="mt-3 text-sm font-medium text-ink" aria-live="polite">
                                    {state === 'holding' ? 'Keep holding' : state === 'sending' ? 'Sending your alert' : 'Press and hold until the ring fills'}
                                </p>
                            </div>

                            {state === 'failed' && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-sos">Couldn't reach the server. Call for help now:</p>
                                    {callButtons}
                                </div>
                            )}
                        </div>
                    )}
                </Modal>
            )}
        </>
    );
}
