import { router } from '@inertiajs/react';
import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';

/** First-run notice: members accept Terms + Privacy Policy and choose whether SOS may attach their location. */
export function PolicyGate() {
    const [sosLocation, setSosLocation] = useState(true);
    const [agree, setAgree] = useState(false);
    const [busy, setBusy] = useState(false);
    const version = '2026-11-09';

    const accept = async () => {
        setBusy(true);
        await api('/me/accept-policies', { body: { version, sos_location: sosLocation } });
        router.reload();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-grove/50 sm:items-center sm:p-4">
            <div role="dialog" aria-modal aria-label="Before you start" className="sheet-in scroll-area max-h-[92dvh] w-full rounded-t-3xl bg-white p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:pb-6 sm:max-w-lg sm:rounded-3xl">
                <h2 className="text-xl font-bold">Before you start</h2>
                <div className="mt-3 space-y-3 text-[15px] leading-7">
                    <p>Your institution provides SOS Connect so you can chat and get help quickly. It keeps your name, role, department and the messages you send. Your password stays with your institution. We never see or store it.</p>
                    <div className="flex gap-3 rounded-2xl bg-sos/8 p-4">
                        <TriangleAlert size={20} className="mt-1 shrink-0 text-sos" />
                        <p><strong>SOS doesn't replace emergency services.</strong> Without internet, messages travel from phone to phone and can be delayed or lost. Call the national emergency number whenever you can.</p>
                    </div>
                </div>
                <div className="mt-5 space-y-3 text-[15px]">
                    <label className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={sosLocation} onChange={(e) => setSosLocation(e.target.checked)} />
                        <span>Add my location when I press SOS <span className="text-muted">(recommended). Only campus responders see it.</span></span>
                    </label>
                    <label className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                        <span>I've read the <a className="font-semibold text-leaf underline" href="/legal/terms-of-service" target="_blank">terms</a>, the <a className="font-semibold text-leaf underline" href="/legal/privacy-policy" target="_blank">privacy policy</a> and the <a className="font-semibold text-leaf underline" href="/legal/sos-emergency-notice" target="_blank">SOS notice</a>.</span>
                    </label>
                </div>
                <button className="btn-primary mt-6 w-full py-3 text-[15px]" disabled={!agree || busy} onClick={accept}>Agree and continue</button>
            </div>
        </div>
    );
}
