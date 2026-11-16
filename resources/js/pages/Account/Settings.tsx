import { Head, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Bell, Check, Music, Play } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';
import { WhatsAppIcon } from '@/components/ProfileSheet';
import { api } from '@/lib/api';
import { playTone, previewRing, setSoundChoices } from '@/lib/tones';

type Contact = { school_phone: string | null; whatsapp: string | null; show_whatsapp: boolean; shown_as: string | null };
type Catalog = { sounds: Record<string, string>; kinds: Record<string, { label: string; set: 'tones' | 'rings' }>; tones: Record<string, string>; rings: Record<string, string> };

/** My WhatsApp number (separate from the school's records) and the tones I hear for each kind of alert. */
export default function Settings() {
    const [contact, setContact] = useState<Contact | null>(null);
    const [number, setNumber] = useState('');
    const [show, setShow] = useState(true);
    const [cat, setCat] = useState<Catalog | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

    useEffect(() => {
        api<{ contact: Contact }>('/me/contact').then((r) => { setContact(r.contact); setNumber(r.contact.whatsapp ?? ''); setShow(r.contact.show_whatsapp); }).catch((e) => setError(e.message));
        api<Catalog>('/me/sounds').then(setCat).catch((e) => setError(e.message));
    }, []);

    const saveContact = async () => {
        setError(null); setMsg(null);
        try {
            const r = await api<{ contact: Contact }>('/me/contact', { method: 'PATCH', body: { whatsapp: number.trim() || null, show_whatsapp: show } });
            setContact(r.contact); setMsg('Saved.');
        } catch (e) { setError((e as Error).message); }
    };
    const choose = async (kind: string, id: string) => {
        if (!cat) return;
        const sounds = { ...cat.sounds, [kind]: id };
        setCat({ ...cat, sounds });
        try {
            const r = await api<{ sounds: Record<string, string> }>('/me/sounds', { method: 'PUT', body: { sounds } });
            setSoundChoices(r.sounds as never);
            router.reload({ only: ['auth'] });
        } catch (e) { setError((e as Error).message); }
    };
    const preview = (set: 'tones' | 'rings', id: string) => (set === 'rings' ? previewRing(id) : playTone(id));

    return (
        <AppLayout title="Profile and sounds">
            <Head title="Profile and sounds" />
            <PageHeader title="Profile and sounds" description="Your WhatsApp number and the tones you hear. These follow you to every device you sign in on." />
            <PageBody narrow>
                <div className="space-y-4">
                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><span className="text-[#1fa855]"><WhatsAppIcon size={22} /></span>My WhatsApp</h2>
                        <p className="mt-1 text-sm text-muted">People who open your profile see this number with a WhatsApp button. The school's records aren't changed.</p>
                        {contact && <>
                            <p className="mt-3 text-[15px]">Number from your school: <strong>{contact.school_phone ?? 'none'}</strong></p>
                            <label className="label mt-3" htmlFor="wa">A different WhatsApp number (optional)</label>
                            <input id="wa" type="tel" inputMode="tel" className="input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Leave empty to use the school's number" />
                            <label className="mt-3 flex items-center gap-2 text-[15px]"><input type="checkbox" className="size-4 accent-leaf" checked={show} onChange={(e) => setShow(e.target.checked)} />Show my number on my profile</label>
                            <p className="mt-2 text-sm text-muted">{contact.shown_as ? <>Others see: <strong>{contact.shown_as}</strong></> : 'Your number is hidden.'}</p>
                            <button className="btn-primary mt-3" onClick={saveContact}>Save</button>
                        </>}
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><Music size={20} className="text-leaf" />Sounds</h2>
                        <p className="mt-1 text-sm text-muted">Choose a tone for each kind of alert; press play to hear it. SOS alarms always use the siren.</p>
                        {cat && (
                            <div className="mt-3 divide-y divide-line/70">
                                {Object.entries(cat.kinds).map(([kind, def]) => {
                                    const list = def.set === 'rings' ? cat.rings : cat.tones;
                                    return (
                                        <div key={kind} className="py-3">
                                            <div className="font-semibold">{def.label}</div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {Object.entries(list).map(([id, label]) => {
                                                    const on = cat.sounds[kind] === id;
                                                    return (
                                                        <button key={id} onClick={() => { choose(kind, id); if (id !== 'silent') preview(def.set, id); }}
                                                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${on ? 'bg-grove text-white' : 'bg-mist text-ink hover:bg-mint'}`} aria-pressed={on}>
                                                            {on ? <Check size={14} /> : id !== 'silent' && <Play size={12} />}{label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <h2 className="flex items-center gap-2 text-lg font-bold"><Bell size={20} className="text-leaf" />Notifications on this computer</h2>
                        <p className="mt-1 text-sm text-muted">Lets SOS Connect tell you about messages, calls and SOS alerts while you're in another tab.</p>
                        {perm === 'granted' ? <p className="mt-3 font-medium text-leaf">On</p>
                            : perm === 'denied' ? <p className="mt-3 text-sm">Blocked by your browser. Allow notifications for this site in the browser's site settings.</p>
                            : perm === 'unsupported' ? <p className="mt-3 text-sm text-muted">This browser can't show notifications.</p>
                            : <button className="btn-primary mt-3" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>}
                    </section>
                    {msg && <p className="rounded-xl bg-mint px-3 py-2 text-sm text-grove">{msg}</p>}
                    {error && <p role="alert" className="rounded-xl bg-sos/10 px-3 py-2 text-sm text-sos">{error}</p>}
                </div>
            </PageBody>
        </AppLayout>
    );
}
