import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, ArrowRight, Camera, Check, CircleAlert, Loader2, RotateCcw, ShieldCheck, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { analyse, cropPhoto, degrees, lightAndSharpness, loadLandmarker, type Frame } from '@/lib/faceEngine';

type Pose = 'front' | 'left' | 'right' | 'up' | 'down' | 'mouth' | 'front_final';
type State = {
    enabled: boolean; required: boolean; blocked: string | null; consent_text: string; poses: Record<Pose, string>;
    current: null | { completed_at: string | null; quality: number | null; captures: { id: number; pose: Pose }[] };
};
type Props = { mode: 'web' | 'app'; base: string; state: State | null; name?: string | null };

type Kind = 'front' | 'blink' | 'turn' | 'vertical' | 'mouth';
type Step = { key: string; kind: Kind; say: string; final?: boolean };
const STEPS: Step[] = [
    { key: 'front', kind: 'front', say: 'Look straight at the camera and keep still' },
    { key: 'blink1', kind: 'blink', say: 'Blink your eyes' },
    { key: 'turn1', kind: 'turn', say: 'Slowly turn your head to the left' },
    { key: 'turn2', kind: 'turn', say: 'Now slowly turn your head to the right' },
    { key: 'up', kind: 'vertical', say: 'Lift your chin and look up' },
    { key: 'down', kind: 'vertical', say: 'Now look down' },
    { key: 'blink2', kind: 'blink', say: 'Blink again' },
    { key: 'mouth', kind: 'mouth', say: 'Open your mouth wide' },
    { key: 'front_final', kind: 'front', say: 'Last one: look straight at the camera and keep still', final: true },
];
const POSE_LABEL: Record<Pose, string> = { front: 'Front', left: 'Left', right: 'Right', up: 'Up', down: 'Down', mouth: 'Mouth open', front_final: 'Front (final)' };

type Shot = { pose: Pose; url: string; status: 'saving' | 'saved' | 'failed'; quality?: number };

function xsrf(): string {
    const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf(), ...(init.headers ?? {}) } });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = (data as { message?: string } | null)?.message;
        // 413 comes from the web server (nginx/Apache) before the app sees the photo.
        throw new Error(res.status === 413
            ? 'The server refused the photo because it is too large. Ask your administrator to allow bigger uploads (nginx: client_max_body_size 64m; PHP: upload_max_filesize and post_max_size 64M).'
            : msg ?? `The server answered with an error (${res.status}).`);
    }
    return data as T;
}

/**
 * Guided face capture, like a bank or passport app: the person follows spoken and written prompts (look straight,
 * blink, turn left and right, look up and down, open mouth) and each photo is taken automatically when the pose is
 * right, sharp and well lit. Each photo is shown and saved as it is taken. Used on the website and inside the phone app.
 */
export default function Capture({ mode, base, state: initial, name }: Props) {
    const [state, setState] = useState<State | null>(initial);
    const [phase, setPhase] = useState<'intro' | 'loading' | 'capturing' | 'saving' | 'done' | 'error'>('intro');
    const [agree, setAgree] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [hint, setHint] = useState<string | null>(null);
    const [good, setGood] = useState(false);
    const [shots, setShots] = useState<Shot[]>([]);
    const [voice, setVoice] = useState(true);
    const [quality, setQuality] = useState<number | null>(null);

    const video = useRef<HTMLVideoElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const scratch = useRef<HTMLCanvasElement>(null);
    const stop = useRef<() => void>(() => {});
    const voiceOn = useRef(true);
    voiceOn.current = voice;

    useEffect(() => () => stop.current(), []);

    const finished = (msg: string) => {
        try { (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }).ReactNativeWebView?.postMessage(msg); } catch { /* not in the app */ }
    };

    const speak = (text: string) => {
        if (!voiceOn.current || typeof speechSynthesis === 'undefined') return;
        try { speechSynthesis.cancel(); speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { rate: 0.95 })); } catch { /* no voice */ }
    };

    const begin = async () => {
        setError(null);
        if (!window.isSecureContext) {
            setError('The camera only works on a secure (https) address. Ask your administrator to set up https for SOS Connect.');
            setPhase('error');
            return;
        }
        setPhase('loading');
        let stream: MediaStream | null = null;
        try {
            const { uuid } = await call<{ uuid: string }>(`${base}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } } });
            const v = video.current!;
            v.srcObject = stream;
            await v.play();
            const landmarker = await loadLandmarker();
            setShots([]);
            setStepIndex(0);
            setPhase('capturing');
            run(uuid, landmarker, stream);
        } catch (e) {
            stream?.getTracks().forEach((t) => t.stop());
            const err = e as Error & { name?: string };
            setError(err.name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this site and try again.'
                : err.name === 'NotFoundError' ? 'No camera was found on this device.'
                    : err.message || 'Could not start the camera.');
            setPhase('error');
        }
    };

    // ---- The capture loop -----------------------------------------------------------------------------
    const run = (uuid: string, landmarker: Awaited<ReturnType<typeof loadLandmarker>>, stream: MediaStream) => {
        const v = video.current!;
        const started = Date.now();
        let alive = true;
        let raf = 0;
        let lastTime = -1;
        let step = 0;
        let holdSince = 0;
        let pause = 0;
        let pitchBase = 0.45;
        let firstTurn: 'left' | 'right' | null = null;
        let firstVertical: 'up' | 'down' | null = null;
        let blinkClosed = false;
        let blinks = 0;
        let mouth = false;
        let lastLight = { brightness: 128, sharpness: 100, at: 0 };
        let prevNose: { x: number; y: number } | null = null;
        let uploads: Promise<unknown> = Promise.resolve();
        const failed = new Set<Pose>();
        let lastError: string | null = null;
        const have = new Set<Pose>();
        let lastHint = '';

        const say = (h: string | null, ok = false) => {
            if (h !== lastHint) { lastHint = h ?? ''; setHint(h); }
            setGood(ok);
        };
        const next = () => {
            step++;
            holdSince = 0;
            pause = performance.now() + 700;
            if (step < STEPS.length) {
                setStepIndex(step);
                speak(STEPS[step].say);
            }
        };

        const take = async (pose: Pose, f: Frame) => {
            const photo = await cropPhoto(v, f, canvas.current!);
            const url = URL.createObjectURL(photo.blob);
            have.add(pose);
            setShots((s) => [...s.filter((x) => x.pose !== pose), { pose, url, status: 'saving' }]);
            const d = degrees(f, pitchBase);
            const metrics = {
                ...d, brightness: Math.round(lastLight.brightness), sharpness: Math.round(lastLight.sharpness), face_width: Math.round(f.box!.w),
                face_ratio: +(f.box!.w / f.width).toFixed(3), eyes_closed: +f.eyesClosed.toFixed(3), mouth_open: +f.mouthOpen.toFixed(3),
                frame_width: f.width, frame_height: f.height,
            };
            const send = async () => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const form = new FormData();
                        form.append('pose', pose);
                        form.append('image', photo.blob, `${pose}.jpg`);
                        form.append('metrics', JSON.stringify(metrics));
                        form.append('landmarks', JSON.stringify(photo.points.map((p) => p.map((n) => +n.toFixed(5)))));
                        const r = await call<{ quality: number }>(`${base}/${uuid}/captures`, { method: 'POST', body: form });
                        failed.delete(pose);
                        setShots((s) => s.map((x) => (x.pose === pose ? { ...x, status: 'saved', quality: r.quality } : x)));
                        return;
                    } catch (e) {
                        lastError = (e as Error).message;
                        if (/too large|being updated|not allowed|switched off/i.test(lastError)) break; // trying again won't help
                        await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1)));
                    }
                }
                failed.add(pose);
                setShots((s) => s.map((x) => (x.pose === pose ? { ...x, status: 'failed' } : x)));
            };
            uploads = uploads.then(send);
        };

        const finish = async () => {
            alive = false;
            cancelAnimationFrame(raf);
            stream.getTracks().forEach((t) => t.stop());
            setPhase('saving');
            speak('Thank you. Saving your photos.');
            await uploads;
            if (failed.size) {
                setError(`Some photos could not be saved. ${lastError ?? 'Check your internet connection.'} Please start again.`);
                setPhase('error');
                return;
            }
            try {
                const r = await call<{ quality: number }>(`${base}/${uuid}/complete`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ liveness: { blinks, mouth, turns: have.has('left') && have.has('right'), nods: have.has('up') && have.has('down'), seconds: Math.round((Date.now() - started) / 1000) } }),
                });
                setQuality(r.quality);
                setPhase('done');
                speak('All done.');
                call<State>(base).then(setState).catch(() => {});
                finished('face:done');
            } catch (e) {
                setError((e as Error).message);
                setPhase('error');
            }
        };

        stop.current = () => { alive = false; cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); };
        speak(STEPS[0].say);

        const handle = (f: Frame, now: number) => {
            if (now < pause) return;
            const s = STEPS[step];
            if (f.faces === 0) { holdSince = 0; return say('We can\'t see your face. Look at the camera.'); }
            if (f.faces > 1) { holdSince = 0; return say('Only you should be in view.'); }
            const box = f.box!;
            const nose = f.points![1];
            const moved = prevNose ? Math.hypot(nose.x - prevNose.x, nose.y - prevNose.y) : 0;
            prevNose = { x: nose.x, y: nose.y };
            if (now - lastLight.at > 250) lastLight = { ...lightAndSharpness(v, box, scratch.current!), at: now };

            const minFace = Math.max(180, f.width * 0.2);
            if (box.w < minFace) { holdSince = 0; return say('Move a little closer.'); }
            if (box.w > f.width * 0.72 || box.h > f.height * 0.92) { holdSince = 0; return say('Move back a little.'); }
            if (lastLight.brightness < 65) { holdSince = 0; return say('It\'s too dark. Face a window or a light.'); }
            if (lastLight.brightness > 220) { holdSince = 0; return say('Too much light behind or on you. Move out of direct light.'); }

            const hold = (ms: number, ok: boolean, msg: string | null) => {
                if (!ok) { holdSince = 0; say(msg); return false; }
                say('Hold still…', true);
                if (!holdSince) holdSince = now;
                return now - holdSince >= ms;
            };

            if (s.kind === 'front') {
                const cx = (box.x + box.w / 2) / f.width, cy = (box.y + box.h / 2) / f.height;
                const msg = Math.abs(cx - 0.5) > 0.16 || Math.abs(cy - 0.5) > 0.2 ? 'Move your face into the middle of the oval.'
                    : Math.abs(f.yaw) > 0.06 ? 'Turn to face the camera straight on.'
                        : Math.abs(f.roll) > 8 ? 'Keep your head level.'
                            : f.pitch < 0.25 || f.pitch > 0.7 ? 'Look straight ahead, not up or down.'
                                : f.eyesClosed > 0.35 ? 'Keep your eyes open.'
                                    : f.mouthOpen > 0.15 ? 'Close your mouth.'
                                        : moved > 0.006 || lastLight.sharpness < 18 ? 'Hold still…'
                                            : null;
                if (hold(700, msg === null, msg)) {
                    if (!s.final) pitchBase = f.pitch;
                    take(s.final ? 'front_final' : 'front', f);
                    if (s.final) { finish(); return; }
                    next();
                }
            } else if (s.kind === 'blink') {
                say('Blink your eyes', false);
                if (f.eyesClosed > 0.5) blinkClosed = true;
                else if (blinkClosed && f.eyesClosed < 0.25) { blinkClosed = false; blinks++; say('Good', true); next(); }
            } else if (s.kind === 'turn') {
                const side: 'left' | 'right' = f.yaw > 0 ? 'left' : 'right';
                const wanted = firstTurn ? (firstTurn === 'left' ? 'right' : 'left') : null;
                const far = Math.abs(f.yaw) > 0.17 && (!wanted || side === wanted);
                const msg = Math.abs(f.yaw) > 0.06 && (!wanted || side === wanted) ? 'Keep turning…' : s.say;
                if (hold(300, far && f.eyesClosed < 0.5, msg)) { firstTurn ??= side; take(side, f); next(); }
            } else if (s.kind === 'vertical') {
                const d = f.pitch - pitchBase;
                const dir: 'up' | 'down' = d < 0 ? 'up' : 'down';
                const wanted = firstVertical ? (firstVertical === 'up' ? 'down' : 'up') : null;
                const far = Math.abs(d) > 0.085 && Math.abs(f.yaw) < 0.12 && (!wanted || dir === wanted);
                if (hold(300, far && f.eyesClosed < 0.6, Math.abs(d) > 0.03 && (!wanted || dir === wanted) ? 'A little more…' : s.say)) {
                    firstVertical ??= dir; take(dir, f); next();
                }
            } else if (s.kind === 'mouth') {
                if (hold(250, f.mouthOpen > 0.45 && Math.abs(f.yaw) < 0.12, f.mouthOpen > 0.2 ? 'Wider…' : s.say)) { mouth = true; take('mouth', f); next(); }
            }
        };

        const tick = () => {
            if (!alive) return;
            if (v.readyState >= 2 && v.currentTime !== lastTime) {
                lastTime = v.currentTime;
                const now = performance.now();
                try { handle(analyse(landmarker.detectForVideo(v, now), v.videoWidth, v.videoHeight), now); } catch { /* skip a frame */ }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
    };

    const restart = () => { stop.current(); setPhase('intro'); setShots([]); setError(null); setAgree(true); };

    const forget = async () => {
        if (!confirm('Delete your face photos from SOS Connect? Copies the school already received are not affected.')) return;
        try { await call(base, { method: 'DELETE' }); setState(await call<State>(base)); } catch (e) { setError((e as Error).message); }
    };

    // ---- Screens --------------------------------------------------------------------------------------
    const step = STEPS[stepIndex];
    const arrow = step?.kind === 'turn' ? (step.key === 'turn1' ? 'left' : 'right') : null;
    const done = shots.length;

    return (
        <div className="flex min-h-dvh flex-col bg-[#071f18] text-white">
            <Head title="Face capture" />
            <header className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
                {mode === 'web' && <Link href="/chats" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="Back"><ArrowLeft size={20} /></Link>}
                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-semibold text-white">Face capture</h1>
                    {name && <p className="truncate text-sm text-white/60">{name}</p>}
                </div>
                {phase === 'capturing' && (
                    <button onClick={() => setVoice((x) => !x)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/10" aria-label={voice ? 'Turn spoken guide off' : 'Turn spoken guide on'}>
                        {voice ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </button>
                )}
            </header>

            {!state ? (
                <Notice>This capture link has expired. Go back to the app and open face capture again.</Notice>
            ) : state.blocked ? (
                <Notice>{state.blocked}</Notice>
            ) : phase === 'intro' ? (
                <div className="mx-auto w-full max-w-md flex-1 px-5 pb-10">
                    {state.current && (
                        <section className="mb-6 rounded-2xl bg-white/5 p-4">
                            <p className="flex items-center gap-2 font-semibold text-[#8fd3b4]"><ShieldCheck size={18} />Your face is captured</p>
                            <p className="mt-1 text-sm text-white/60">{state.current.completed_at ? new Date(state.current.completed_at).toLocaleString() : ''}{state.current.quality ? ` · quality ${Math.round(state.current.quality)}/100` : ''}</p>
                            <div className="mt-3 grid grid-cols-4 gap-2">
                                {state.current.captures.map((c) => (
                                    <figure key={c.id} className="overflow-hidden rounded-lg bg-black/40">
                                        <img src={`${base}/captures/${c.id}/image`} alt={POSE_LABEL[c.pose]} className="aspect-[3/4] w-full object-cover" loading="lazy" />
                                        <figcaption className="truncate px-1 py-0.5 text-center text-[10px] text-white/70">{POSE_LABEL[c.pose]}</figcaption>
                                    </figure>
                                ))}
                            </div>
                            <button onClick={forget} className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#ff9aa4] hover:underline"><Trash2 size={14} />Delete my face photos</button>
                        </section>
                    )}
                    {state.required && !state.current && <p className="mb-4 rounded-xl bg-amber/20 px-3 py-2.5 text-sm">Your institution asks everyone to capture their face.</p>}
                    <h2 className="text-2xl font-bold text-white">{state.current ? 'Capture again' : 'Let\'s capture your face'}</h2>
                    <p className="mt-2 text-white/70">It takes about a minute. You'll be asked to look straight, blink, turn your head left and right, look up and down, and open your mouth. Each photo is taken for you when it's right.</p>
                    <ul className="mt-5 space-y-2 text-sm text-white/80">
                        <li>• Find good light on your face (face a window or a lamp).</li>
                        <li>• Remove sunglasses, face masks and caps. Normal glasses are fine.</li>
                        <li>• Hold the phone or sit at arm's length, at eye level.</li>
                    </ul>
                    <label className="mt-6 flex gap-3 rounded-xl bg-white/5 p-4 text-sm text-white/80">
                        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[#1e7b57]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                        <span>{state.consent_text}</span>
                    </label>
                    <button disabled={!agree} onClick={begin} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1e7b57] py-3.5 text-[15px] font-semibold disabled:opacity-40">
                        <Camera size={18} />Start
                    </button>
                </div>
            ) : phase === 'error' ? (
                <div className="mx-auto w-full max-w-md flex-1 px-5">
                    <p role="alert" className="flex gap-2 rounded-xl bg-[#d62839]/20 px-4 py-3 text-sm"><CircleAlert size={18} className="mt-px shrink-0" />{error}</p>
                    <button onClick={restart} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1e7b57] py-3.5 font-semibold"><RotateCcw size={18} />Try again</button>
                </div>
            ) : (
                <div className="flex flex-1 flex-col items-center px-4 pb-6">
                    {(phase === 'capturing' || phase === 'loading') && (
                        <p aria-live="polite" className="min-h-[3.5rem] max-w-md text-center text-xl font-semibold">{phase === 'loading' ? 'Starting the camera…' : step.say}</p>
                    )}
                    <div className={`relative mt-2 aspect-[3/4] w-[min(78vw,340px)] ${phase === 'saving' || phase === 'done' ? 'hidden' : ''}`}>
                        <div className={`absolute inset-0 overflow-hidden rounded-[50%] ring-4 transition-colors ${good ? 'ring-[#3ddc97]' : 'ring-white/25'}`}>
                            <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />
                        </div>
                        <Progress total={STEPS.length} done={phase === 'capturing' ? stepIndex : 0} />
                        {phase === 'loading' && <div className="absolute inset-0 grid place-items-center"><Loader2 className="animate-spin" size={36} /></div>}
                        {arrow && phase === 'capturing' && (
                            <div className={`absolute top-1/2 -translate-y-1/2 animate-pulse text-[#3ddc97] ${arrow === 'left' ? '-left-10' : '-right-10'}`}>
                                {arrow === 'left' ? <ArrowLeft size={36} /> : <ArrowRight size={36} />}
                            </div>
                        )}
                    </div>
                    {phase === 'capturing' && <p className={`mt-4 min-h-6 text-center text-[15px] ${good ? 'text-[#3ddc97]' : 'text-white/75'}`}>{hint}</p>}

                    {(phase === 'saving' || phase === 'done') && (
                        <div className="w-full max-w-md text-center">
                            {phase === 'saving'
                                ? <p className="flex items-center justify-center gap-2 text-lg font-semibold"><Loader2 className="animate-spin" size={20} />Saving your photos…</p>
                                : <>
                                    <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#1e7b57]"><Check size={34} /></div>
                                    <p className="mt-3 text-xl font-semibold">Your face is captured</p>
                                    {quality !== null && <p className="text-sm text-white/60">Photo quality {Math.round(quality)}/100</p>}
                                </>}
                        </div>
                    )}

                    {done > 0 && (
                        <div className="mt-6 grid w-full max-w-md grid-cols-4 gap-2 sm:grid-cols-7">
                            {shots.map((s) => (
                                <figure key={s.pose} className="relative overflow-hidden rounded-lg bg-black/40">
                                    <img src={s.url} alt={POSE_LABEL[s.pose]} className="aspect-[3/4] w-full object-cover" />
                                    <span className={`absolute top-1 right-1 grid size-5 place-items-center rounded-full ${s.status === 'saved' ? 'bg-[#1e7b57]' : s.status === 'failed' ? 'bg-[#d62839]' : 'bg-black/60'}`}>
                                        {s.status === 'saved' ? <Check size={12} /> : s.status === 'failed' ? <CircleAlert size={12} /> : <Loader2 size={12} className="animate-spin" />}
                                    </span>
                                    <figcaption className="truncate px-1 py-0.5 text-center text-[10px] text-white/70">{POSE_LABEL[s.pose]}</figcaption>
                                </figure>
                            ))}
                        </div>
                    )}

                    {phase === 'done' && (
                        mode === 'web'
                            ? <Link href="/chats" className="mt-8 inline-flex w-full max-w-md items-center justify-center rounded-full bg-[#1e7b57] py-3.5 font-semibold">Done</Link>
                            : <button onClick={() => finished('face:close')} className="mt-8 inline-flex w-full max-w-md items-center justify-center rounded-full bg-[#1e7b57] py-3.5 font-semibold">Done</button>
                    )}
                    {phase === 'capturing' && <button onClick={restart} className="mt-6 text-sm text-white/60 underline">Start again</button>}
                </div>
            )}
            <canvas ref={canvas} className="hidden" />
            <canvas ref={scratch} className="hidden" />
        </div>
    );
}

function Notice({ children }: { children: React.ReactNode }) {
    return <div className="mx-auto w-full max-w-md flex-1 px-5"><p className="flex gap-2 rounded-xl bg-white/10 px-4 py-3"><CircleAlert size={18} className="mt-0.5 shrink-0" />{children}</p></div>;
}

/** Dots around the oval: one per step. */
function Progress({ total, done }: { total: number; done: number }) {
    return (
        <div className="absolute -bottom-7 left-1/2 flex -translate-x-1/2 gap-1.5" aria-label={`Step ${Math.min(done + 1, total)} of ${total}`}>
            {Array.from({ length: total }, (_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i < done ? 'w-4 bg-[#3ddc97]' : i === done ? 'w-4 bg-white' : 'w-1.5 bg-white/30'}`} />)}
        </div>
    );
}
