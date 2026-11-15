import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const MAX_SECONDS = 5 * 60;

export const clock = (s: number) => {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** The first recording format this browser supports (Chrome/Firefox: webm/ogg opus, Safari: mp4). */
function pickFormat(): { mime: string; ext: string } | null {
    if (typeof MediaRecorder === 'undefined') return null;
    // m4a first: it plays everywhere, including iPhones. Browsers that can't record it fall back to webm/ogg.
    for (const [mime, ext] of [['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg']] as const) {
        if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    }
    return null;
}

export const canRecordVoice = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickFormat();

/**
 * Records a voice note: shows a live timer and level, with Cancel and Send. Stops by itself at 5 minutes.
 * onSend gets the audio file and its length in seconds.
 */
export function VoiceRecorder({ onSend, onCancel, onError }: { onSend: (file: File, seconds: number) => void; onCancel: () => void; onError: (msg: string) => void }) {
    const [seconds, setSeconds] = useState(0);
    const [level, setLevel] = useState(0);
    const rec = useRef<MediaRecorder | null>(null);
    const chunks = useRef<Blob[]>([]);
    const stream = useRef<MediaStream | null>(null);
    const started = useRef(0);
    const keep = useRef(false);
    const format = useRef(pickFormat());

    useEffect(() => {
        let raf = 0;
        let timer = 0;
        let audioCtx: AudioContext | null = null;
        let cancelled = false;
        (async () => {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
                if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
                stream.current = s;
                const r = new MediaRecorder(s, format.current ? { mimeType: format.current.mime, audioBitsPerSecond: 32000 } : undefined);
                r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
                r.onstop = () => {
                    s.getTracks().forEach((t) => t.stop());
                    const secs = (Date.now() - started.current) / 1000;
                    if (!keep.current || secs < 0.7) { if (keep.current) onError('That was too short. Hold on a little longer.'); return; }
                    const type = (r.mimeType || format.current?.mime || 'audio/webm').split(';')[0];
                    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
                    onSend(new File(chunks.current, `voice-${Date.now()}.${ext}`, { type }), Math.round(secs));
                };
                r.start(250);
                rec.current = r;
                started.current = Date.now();
                timer = window.setInterval(() => {
                    const secs = (Date.now() - started.current) / 1000;
                    setSeconds(secs);
                    if (secs >= MAX_SECONDS) stop(true);
                }, 200);
                // A simple level meter, so people can see the microphone is picking them up.
                audioCtx = new AudioContext();
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                audioCtx.createMediaStreamSource(s).connect(analyser);
                const data = new Uint8Array(analyser.frequencyBinCount);
                const tick = () => {
                    analyser.getByteTimeDomainData(data);
                    let peak = 0;
                    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
                    setLevel(Math.min(1, peak / 64));
                    raf = requestAnimationFrame(tick);
                };
                tick();
            } catch (e) {
                onError((e as Error).name === 'NotAllowedError'
                    ? 'Allow the microphone for this site (the icon in the address bar) to record voice notes.'
                    : "Couldn't use the microphone. Check that one is connected.");
                onCancel();
            }
        })();
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            window.clearInterval(timer);
            audioCtx?.close().catch(() => {});
            if (rec.current?.state === 'recording') { keep.current = false; rec.current.stop(); }
            stream.current?.getTracks().forEach((t) => t.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stop = (send: boolean) => {
        keep.current = send;
        if (rec.current?.state === 'recording') rec.current.stop();
        if (!send) onCancel();
    };

    return (
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-3xl bg-white px-2 py-1.5" role="group" aria-label="Recording a voice note">
            <button type="button" className="icon-btn shrink-0 text-sos" onClick={() => stop(false)} aria-label="Cancel voice note" title="Cancel"><Trash2 size={20} /></button>
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-sos" aria-hidden />
            <span className="w-12 shrink-0 font-medium tabular-nums" aria-live="off">{clock(seconds)}</span>
            <div className="flex h-8 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
                {Array.from({ length: 28 }, (_, i) => (
                    <span key={i} className="w-[3px] shrink-0 rounded-full bg-leaf/70 transition-[height] duration-100"
                        style={{ height: `${Math.max(12, Math.min(100, level * 100 * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + seconds * 3)))))}%` }} />
                ))}
            </div>
            <button type="button" onClick={() => stop(true)} aria-label="Send voice note" title="Send"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf text-white hover:bg-leaf-dark"><SendHorizontal size={19} /></button>
        </div>
    );
}

export function MicButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} aria-label="Record a voice note" title="Record a voice note"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-leaf text-white transition-colors hover:bg-leaf-dark disabled:opacity-40">
            <Mic size={20} />
        </button>
    );
}

/** Only one voice note plays at a time. */
let playing: HTMLAudioElement | null = null;

/** Plays a voice note: play/pause, a bar you can click to jump, time, and speed (1x, 1.5x, 2x). */
export function VoicePlayer({ src, seconds, mine = false }: { src: string; seconds?: number | null; mine?: boolean }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [on, setOn] = useState(false);
    const [now, setNow] = useState(0);
    const [total, setTotal] = useState(seconds ?? 0);
    const [rate, setRate] = useState(1);
    const [failed, setFailed] = useState(false);

    const toggle = async () => {
        const a = audio.current;
        if (!a) return;
        if (on) { a.pause(); return; }
        if (playing && playing !== a) playing.pause();
        playing = a;
        try { await a.play(); } catch { setFailed(true); }
    };
    const seek = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
        const a = audio.current;
        if (!a || !total) return;
        if ('key' in e) {
            if (e.key === 'ArrowRight') a.currentTime = Math.min(total, a.currentTime + 5);
            if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5);
            return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
    };
    const progress = total ? Math.min(1, now / total) : 0;

    return (
        <div className="my-1 flex w-64 max-w-full items-center gap-2.5">
            <audio ref={audio} src={src} preload="metadata"
                onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(d); }}
                onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(d); }}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={(e) => { setOn(false); setNow(0); e.currentTarget.currentTime = 0; }}
                onError={() => setFailed(true)} />
            <button type="button" onClick={toggle} aria-label={on ? 'Pause voice note' : 'Play voice note'}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf text-white hover:bg-leaf-dark">
                {on ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <div className="min-w-0 flex-1">
                <div role="slider" tabIndex={0} aria-label="Position in voice note" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(now)}
                    onClick={seek} onKeyDown={seek} className="relative flex h-5 cursor-pointer items-center">
                    <div className={`h-1 w-full rounded-full ${mine ? 'bg-grove/15' : 'bg-line'}`} />
                    <div className="absolute left-0 h-1 rounded-full bg-leaf" style={{ width: `${progress * 100}%` }} />
                    <div className="absolute size-3 -translate-x-1/2 rounded-full bg-leaf" style={{ left: `${progress * 100}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-muted">
                    <span className="tabular-nums">{failed ? "Can't play this here" : clock(on || now ? now : total)}</span>
                    <button type="button" className="font-semibold hover:text-ink" aria-label="Playback speed"
                        onClick={() => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audio.current) audio.current.playbackRate = next; }}>
                        {rate}x
                    </button>
                </div>
            </div>
        </div>
    );
}
