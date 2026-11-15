import { Mic, MicOff, Phone, PhoneOff, Users, Video, VideoOff, X } from 'lucide-react';
import { Avatar } from './ui';
import { usePage } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { api, uuid } from '@/lib/api';
import { listenUser, liveFast } from '@/lib/live';
import { askForCallAlerts, startRing, stopRing } from '@/lib/ring';
import type { SharedProps } from '@/types';

type Kind = 'voice' | 'video';
type CallInfo = { uuid: string; type: Kind; peer: { id: number; name: string }; direction: 'in' | 'out' };
type Phase = 'idle' | 'ringing-in' | 'ringing-out' | 'connecting' | 'connected';

/** Start a one-to-one call from anywhere. */
export function startCall(peer: { id: number; name: string }, type: Kind) {
    window.dispatchEvent(new CustomEvent('sos:call', { detail: { ...peer, type } }));
}

/** Start (or join the running) call in a group chat. */
export function startGroupCall(conversationId: number, type: Kind) {
    window.dispatchEvent(new CustomEvent('sos:groupcall', { detail: { conversationId, type } }));
}

/** Join a group call you were rung for or saw in the chat. */
export function joinGroupCall(callUuid: string) {
    window.dispatchEvent(new CustomEvent('sos:groupcall', { detail: { callUuid } }));
}

const timer = (since: number | null, now: number) => {
    if (!since) return '';
    const s = Math.max(0, Math.floor((now - since) / 1000));
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function useNow(active: boolean) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return;
        const t = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, [active]);
    return now;
}

const mediaError = (e: unknown, type: Kind) => (e as Error)?.name === 'NotAllowedError'
    ? `Allow the ${type === 'video' ? 'camera and microphone' : 'microphone'} for this site (the icon in the address bar), then try again.`
    : (e as Error)?.name === 'NotFoundError' ? `No ${type === 'video' ? 'camera or microphone' : 'microphone'} was found on this device.`
    : (e as Error)?.message || 'The call could not start.';

/** Holds both kinds of call; only one call at a time. */
export function CallManager() {
    const [notice, setNotice] = useState<string | null>(null);
    const busy = useRef({ direct: false, group: false });
    return (
        <>
            <DirectCall busy={busy} onNotice={setNotice} />
            <GroupCall busy={busy} onNotice={setNotice} />
            {notice && (
                <div role="alert" className="fade-in fixed inset-x-3 bottom-24 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl md:bottom-6">
                    <span className="min-w-0 flex-1">{notice}</span>
                    <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0"><X size={18} /></button>
                </div>
            )}
        </>
    );
}

type Busy = React.MutableRefObject<{ direct: boolean; group: boolean }>;

const round = 'flex size-14 items-center justify-center rounded-full transition-colors sm:size-16';

/**
 * One-to-one WebRTC calls. All mutable call state lives in refs so the realtime listeners (registered once)
 * always see the current call.
 */
function DirectCall({ busy, onNotice }: { busy: Busy; onNotice: (m: string) => void }) {
    const { auth, reverb } = usePage<SharedProps>().props;
    const [phase, setPhase] = useState<Phase>('idle');
    const [info, setInfo] = useState<CallInfo | null>(null);
    const [muted, setMuted] = useState(false);
    const [camOff, setCamOff] = useState(false);
    const [peerCamOff, setPeerCamOff] = useState(false);
    const [since, setSince] = useState<number | null>(null);
    const infoRef = useRef<CallInfo | null>(null);
    const pc = useRef<RTCPeerConnection | null>(null);
    const local = useRef<MediaStream | null>(null);
    const remote = useRef<MediaStream | null>(null);
    const pendingIce = useRef<RTCIceCandidateInit[]>([]);
    const remoteEl = useRef<HTMLVideoElement>(null);
    const localEl = useRef<HTMLVideoElement>(null);
    const ringTimer = useRef<number | null>(null);
    const now = useNow(phase === 'connected');

    const setCall = (c: CallInfo | null) => {
        if (!!c !== !!infoRef.current) liveFast(!!c); // without the websocket, check for call signals every second
        infoRef.current = c; setInfo(c); busy.current.direct = !!c;
    };

    const cleanup = () => {
        if (ringTimer.current) window.clearTimeout(ringTimer.current);
        pc.current?.close();
        pc.current = null;
        local.current?.getTracks().forEach((t) => t.stop());
        local.current = null;
        remote.current = null;
        pendingIce.current = [];
        setCall(null);
        setPhase('idle');
        setMuted(false);
        setCamOff(false);
        setPeerCamOff(false);
        setSince(null);
    };

    const signal = (data: unknown) => infoRef.current && api(`/calls/${infoRef.current.uuid}/signal`, { body: { data } }).catch(() => {});
    const state = (action: string) => infoRef.current && api(`/calls/${infoRef.current.uuid}/state`, { body: { action } }).catch(() => {});

    const createPeer = async (type: Kind) => {
        const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/calls/ice-servers');
        const peer = new RTCPeerConnection({ iceServers });
        local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
        local.current.getTracks().forEach((t) => peer.addTrack(t, local.current!));
        if (localEl.current) localEl.current.srcObject = local.current;
        peer.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate.toJSON() });
        peer.ontrack = (e) => {
            remote.current = e.streams[0];
            if (remoteEl.current) remoteEl.current.srcObject = e.streams[0];
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'connected') { setPhase('connected'); setSince((s) => s ?? Date.now()); }
            if (peer.connectionState === 'failed') { onNotice('The call dropped: the connection failed.'); state('failed'); cleanup(); }
        };
        pc.current = peer;
        return peer;
    };

    const flushIce = async () => {
        for (const c of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(c).catch(() => {});
    };

    useEffect(() => {
        const onStart = async (e: Event) => {
            if (infoRef.current || busy.current.group) { onNotice('Finish your current call first.'); return; }
            const { id, name, type } = (e as CustomEvent).detail;
            askForCallAlerts();
            const callUuid = uuid();
            setCall({ uuid: callUuid, type, peer: { id, name }, direction: 'out' });
            setPhase('ringing-out');
            try {
                await api('/calls', { body: { callee_id: id, type, call_uuid: callUuid } });
                ringTimer.current = window.setTimeout(() => { onNotice(`${name} didn't answer.`); state('missed'); cleanup(); }, 45_000);
            } catch (err) {
                onNotice((err as Error).message.includes('busy') || (err as { status?: number }).status === 409 ? `${name} is on another call.` : (err as Error).message);
                cleanup();
            }
        };
        window.addEventListener('sos:call', onStart);

        const offs: (() => void)[] = [];
        offs.push(listenUser('call.incoming', (e: { call_uuid: string; type: Kind; caller: { id: number; name: string } }) => {
            if (infoRef.current || busy.current.group) return; // busy: the server already logs it
            setCall({ uuid: e.call_uuid, type: e.type, peer: e.caller, direction: 'in' });
            setPhase('ringing-in');
            ringTimer.current = window.setTimeout(() => cleanup(), 45_000);
        }));
        offs.push(listenUser('call.state', async (e: { call_uuid: string; status: string }) => {
            const cur = infoRef.current;
            if (!cur || cur.uuid !== e.call_uuid) return;
            if (e.status === 'answered' && cur.direction === 'out') {
                if (ringTimer.current) window.clearTimeout(ringTimer.current);
                setPhase('connecting');
                try {
                    const peer = await createPeer(cur.type);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    signal({ sdp: offer });
                } catch (err) {
                    onNotice(mediaError(err, cur.type));
                    state('failed');
                    cleanup();
                }
            } else if (['rejected', 'ended', 'missed', 'failed', 'busy'].includes(e.status)) {
                if (e.status === 'rejected' && cur.direction === 'out') onNotice(`${cur.peer.name} declined the call.`);
                if (e.status === 'busy') onNotice(`${cur.peer.name} is on another call.`);
                cleanup();
            }
        }));
        offs.push(listenUser('call.signal', async (e: { call_uuid: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; camera?: boolean } }) => {
            const cur = infoRef.current;
            if (!cur || cur.uuid !== e.call_uuid) return;
            const peer = pc.current;
            if (typeof e.data.camera === 'boolean') setPeerCamOff(!e.data.camera);
            if (e.data.sdp?.type === 'offer' && peer) {
                await peer.setRemoteDescription(e.data.sdp);
                await flushIce();
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                signal({ sdp: answer });
            } else if (e.data.sdp?.type === 'answer' && peer) {
                await peer.setRemoteDescription(e.data.sdp);
                await flushIce();
            } else if (e.data.candidate) {
                if (peer?.remoteDescription) await peer.addIceCandidate(e.data.candidate).catch(() => {});
                else pendingIce.current.push(e.data.candidate);
            }
        }));

        // Opened the page from a call notification (or a call started while it was loading): show it.
        api<{ call: { call_uuid: string; type: Kind; caller: { id: number; name: string } } | null }>('/calls/pending')
            .then((r) => { if (r.call && !infoRef.current && !busy.current.group) { setCall({ uuid: r.call.call_uuid, type: r.call.type, peer: r.call.caller, direction: 'in' }); setPhase('ringing-in'); ringTimer.current = window.setTimeout(() => cleanup(), 45_000); } })
            .catch(() => {});

        return () => { window.removeEventListener('sos:call', onStart); offs.forEach((f) => f()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-attach streams when the elements re-render (e.g. switching layouts).
    useEffect(() => {
        if (remoteEl.current && remote.current && remoteEl.current.srcObject !== remote.current) remoteEl.current.srcObject = remote.current;
        if (localEl.current && local.current && localEl.current.srcObject !== local.current) localEl.current.srcObject = local.current;
    });

    // Ringtone for incoming calls, ringback while calling, silence otherwise.
    useEffect(() => {
        if (phase === 'ringing-in') startRing('incoming', info?.peer.name, () => window.focus());
        else if (phase === 'ringing-out') startRing('outgoing');
        else stopRing();
        return () => stopRing();
    }, [phase]);

    const accept = async () => {
        const cur = infoRef.current;
        if (!cur) return;
        askForCallAlerts();
        if (ringTimer.current) window.clearTimeout(ringTimer.current);
        setPhase('connecting');
        try {
            await createPeer(cur.type); // media ready BEFORE we tell the caller to send an offer
            state('answer');
        } catch (err) {
            onNotice(mediaError(err, cur.type));
            state('failed');
            cleanup();
        }
    };
    const hangUp = () => { state(phase === 'ringing-in' ? 'reject' : 'end'); cleanup(); };
    const toggleCam = () => {
        const next = !camOff;
        local.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
        setCamOff(next);
        signal({ camera: !next });
    };

    if (phase === 'idle' || !info) return null;

    const video = info.type === 'video';
    const statusText = phase === 'ringing-in' ? `Incoming ${info.type} call` : phase === 'ringing-out' ? 'Ringing…' : phase === 'connecting' ? 'Connecting…' : timer(since, now);
    const showRemoteVideo = video && phase === 'connected' && !peerCamOff;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-grove text-white" role="dialog" aria-modal aria-label={`Call with ${info.peer.name}`}>
            {video && <video ref={remoteEl} autoPlay playsInline className={`absolute inset-0 h-full w-full bg-black object-contain sm:object-cover ${showRemoteVideo ? '' : 'invisible'}`} />}
            {!video && <audio ref={remoteEl as unknown as React.RefObject<HTMLAudioElement>} autoPlay />}
            {video && (
                <video ref={localEl} autoPlay playsInline muted
                    className={`absolute top-[calc(env(safe-area-inset-top)+16px)] right-4 z-10 h-36 w-24 -scale-x-100 rounded-2xl bg-black object-cover ring-2 ring-white/30 sm:h-44 sm:w-32 ${camOff || phase === 'ringing-in' || phase === 'ringing-out' ? 'invisible' : ''}`} />
            )}

            <div className={`relative z-10 flex flex-col items-center px-6 pt-[calc(env(safe-area-inset-top)+64px)] ${showRemoteVideo ? 'items-start pt-[calc(env(safe-area-inset-top)+20px)]' : ''}`}>
                {!showRemoteVideo && (
                    <span className={`relative inline-flex rounded-full ${phase === 'ringing-in' || phase === 'ringing-out' ? 'call-pulse' : ''}`}>
                        <Avatar name={info.peer.name} size={112} />
                    </span>
                )}
                <div className={`${showRemoteVideo ? 'text-lg drop-shadow' : 'mt-5 text-2xl'} max-w-full truncate font-semibold`}>{info.peer.name}</div>
                <div className="mt-1 text-white/75 tabular-nums drop-shadow" aria-live="polite">
                    {statusText}{video && phase === 'connected' && peerCamOff ? ' · camera off' : ''}
                </div>
            </div>

            <div className="relative z-10 mt-auto flex items-start justify-center gap-5 bg-gradient-to-t from-black/50 to-transparent px-6 pt-10 pb-[calc(env(safe-area-inset-bottom)+28px)] sm:gap-8">
                {phase === 'ringing-in' ? (
                    <>
                        <Labeled label="Decline"><button className={`${round} bg-sos hover:bg-sos-dark`} onClick={hangUp} aria-label="Decline"><PhoneOff size={26} /></button></Labeled>
                        <Labeled label="Answer"><button className={`${round} answer-bounce bg-leaf hover:bg-leaf-dark`} onClick={accept} aria-label="Answer" autoFocus>{video ? <Video size={26} /> : <Phone size={26} />}</button></Labeled>
                    </>
                ) : (
                    <>
                        <Labeled label={muted ? 'Unmute' : 'Mute'}>
                            <button className={`${round} ${muted ? 'bg-white text-grove' : 'bg-white/15 hover:bg-white/25'}`} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}
                                onClick={() => { local.current?.getAudioTracks().forEach((t) => (t.enabled = muted)); setMuted(!muted); }}>
                                {muted ? <MicOff size={24} /> : <Mic size={24} />}
                            </button>
                        </Labeled>
                        {video && (
                            <Labeled label={camOff ? 'Camera on' : 'Camera off'}>
                                <button className={`${round} ${camOff ? 'bg-white text-grove' : 'bg-white/15 hover:bg-white/25'}`} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={camOff} onClick={toggleCam}>
                                    {camOff ? <VideoOff size={24} /> : <Video size={24} />}
                                </button>
                            </Labeled>
                        )}
                        <Labeled label={phase === 'ringing-out' ? 'Cancel' : 'End'}>
                            <button className={`${round} bg-sos hover:bg-sos-dark`} onClick={hangUp} aria-label={phase === 'ringing-out' ? 'Cancel call' : 'Hang up'}><PhoneOff size={24} /></button>
                        </Labeled>
                    </>
                )}
            </div>
        </div>
    );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
    return <div className="flex flex-col items-center gap-2">{children}<span className="text-xs text-white/80">{label}</span></div>;
}

// ---- Group calls ------------------------------------------------------------------------------------

type GroupState = { call_uuid: string; type: Kind; conversation_id: number; conversation_name: string | null; participants: { id: number; name: string }[]; max: number; started_at: string };
type Ring = { call_uuid: string; type: Kind; conversation_name: string | null; caller: { id: number; name: string } };
type Remote = { id: number; name: string; stream: MediaStream | null; muted?: boolean; camera?: boolean; state: string };

/**
 * Group calls: every browser connects to every other one. Whoever joins sends an offer to each person already in
 * the call; those already there only answer, so two people never offer to each other at once.
 */
function GroupCall({ busy, onNotice }: { busy: Busy; onNotice: (m: string) => void }) {
    const { auth, reverb } = usePage<SharedProps>().props;
    const me = auth!.user;
    const [call, setCallState] = useState<GroupState | null>(null);
    const [ring, setRing] = useState<Ring | null>(null);
    const [remotes, setRemotes] = useState<Record<number, Remote>>({});
    const [muted, setMuted] = useState(false);
    const [camOff, setCamOff] = useState(false);
    const [joining, setJoining] = useState(false);
    const callRef = useRef<GroupState | null>(null);
    const peers = useRef(new Map<number, { pc: RTCPeerConnection; ice: RTCIceCandidateInit[] }>());
    const local = useRef<MediaStream | null>(null);
    const ice = useRef<RTCIceServer[]>([]);
    const localEl = useRef<HTMLVideoElement>(null);
    const ringTimer = useRef<number | null>(null);
    const now = useNow(!!call);

    const setCall = (c: GroupState | null) => {
        if (!!c !== !!callRef.current) liveFast(!!c);
        callRef.current = c; setCallState(c); busy.current.group = !!c;
    };
    const patch = (id: number, p: Partial<Remote>) => setRemotes((r) => (r[id] || p.name ? { ...r, [id]: { ...{ id, name: 'Member', stream: null, state: 'connecting' }, ...r[id], ...p } } : r));
    const send = (to: number, data: unknown) => callRef.current && api(`/group-calls/${callRef.current.call_uuid}/signal`, { body: { to, data } }).catch(() => {});

    const closePeer = (id: number) => {
        peers.current.get(id)?.pc.close();
        peers.current.delete(id);
        setRemotes((r) => { const n = { ...r }; delete n[id]; return n; });
    };

    const cleanup = () => {
        peers.current.forEach((p) => p.pc.close());
        peers.current.clear();
        local.current?.getTracks().forEach((t) => t.stop());
        local.current = null;
        setRemotes({});
        setCall(null);
        setMuted(false);
        setCamOff(false);
    };

    const peerFor = (id: number, name?: string) => {
        const existing = peers.current.get(id);
        if (existing) return existing.pc;
        const pc = new RTCPeerConnection({ iceServers: ice.current });
        local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current!));
        pc.onicecandidate = (e) => e.candidate && send(id, { candidate: e.candidate.toJSON() });
        pc.ontrack = (e) => patch(id, { stream: e.streams[0] });
        pc.onconnectionstatechange = () => {
            patch(id, { state: pc.connectionState });
            if (pc.connectionState === 'failed') closePeer(id);
        };
        peers.current.set(id, { pc, ice: [] });
        patch(id, { name: name ?? 'Member', state: 'connecting' });
        return pc;
    };

    const enter = async (fetchState: () => Promise<GroupState>) => {
        stopRing();
        if (callRef.current || busy.current.direct) { onNotice('Finish your current call first.'); return; }
        setJoining(true);
        setRing(null);
        try {
            const st = await fetchState();
            ice.current = (await api<{ iceServers: RTCIceServer[] }>('/calls/ice-servers')).iceServers;
            local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true },
                video: st.type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false });
            setCall(st);
            // I'm the newcomer: I call everyone already here.
            for (const p of st.participants.filter((x) => x.id !== me.id)) {
                const pc = peerFor(p.id, p.name);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                send(p.id, { sdp: offer });
            }
        } catch (e) {
            const err = e as Error & { status?: number };
            onNotice(err.name?.startsWith('Not') ? mediaError(err, 'video') : err.message);
            if (callRef.current) leave(); else cleanup();
        } finally {
            setJoining(false);
        }
    };

    const leave = () => {
        const c = callRef.current;
        if (c) api(`/group-calls/${c.call_uuid}/leave`, { method: 'POST' }).catch(() => {});
        cleanup();
    };

    useEffect(() => {
        const onStart = (e: Event) => {
            const d = (e as CustomEvent).detail as { conversationId?: number; type?: Kind; callUuid?: string };
            if (d.callUuid) enter(() => api<GroupState>(`/group-calls/${d.callUuid}/join`, { method: 'POST' }));
            else enter(() => api<GroupState>(`/conversations/${d.conversationId}/call`, { body: { type: d.type } }));
        };
        window.addEventListener('sos:groupcall', onStart);

        const offs: (() => void)[] = [];
        offs.push(listenUser('groupcall.ring', (e: Ring) => {
            if (callRef.current || busy.current.direct) return;
            setRing(e);
            startRing('incoming', `${e.caller.name} (${e.conversation_name ?? 'group'})`, () => window.focus());
            if (ringTimer.current) window.clearTimeout(ringTimer.current);
            ringTimer.current = window.setTimeout(() => { setRing(null); stopRing(); }, 40_000);
        }));
        offs.push(listenUser('groupcall.joined', (e: { call_uuid: string; user: { id: number; name: string } }) => {
            if (callRef.current?.call_uuid !== e.call_uuid) return;
            patch(e.user.id, { name: e.user.name, state: 'connecting' }); // they'll send me an offer
        }));
        offs.push(listenUser('groupcall.left', (e: { call_uuid: string; user_id: number }) => {
            if (callRef.current?.call_uuid === e.call_uuid) closePeer(e.user_id);
        }));
        offs.push(listenUser('groupcall.signal', async (e: { call_uuid: string; from: number; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; muted?: boolean; camera?: boolean } }) => {
            if (callRef.current?.call_uuid !== e.call_uuid) return;
            const { sdp, candidate } = e.data;
            if (typeof e.data.muted === 'boolean' || typeof e.data.camera === 'boolean') patch(e.from, { muted: e.data.muted, camera: e.data.camera });
            if (sdp?.type === 'offer') {
                const pc = peerFor(e.from);
                await pc.setRemoteDescription(sdp);
                for (const c of peers.current.get(e.from)?.ice.splice(0) ?? []) await pc.addIceCandidate(c).catch(() => {});
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                send(e.from, { sdp: answer });
            } else if (sdp?.type === 'answer') {
                const p = peers.current.get(e.from);
                if (p) {
                    await p.pc.setRemoteDescription(sdp);
                    for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
                }
            } else if (candidate) {
                const p = peers.current.get(e.from);
                if (p?.pc.remoteDescription) await p.pc.addIceCandidate(candidate).catch(() => {});
                else if (p) p.ice.push(candidate);
                else peerFor(e.from) && peers.current.get(e.from)!.ice.push(candidate);
            }
        }));

        // Closing the tab mid-call: the others stop hearing from us and drop us within 45 seconds.
        return () => { window.removeEventListener('sos:groupcall', onStart); offs.forEach((f) => f()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // "Still here" every 15 seconds; drops anyone the server no longer counts as in the call.
    useEffect(() => {
        if (!call) return;
        const t = window.setInterval(async () => {
            try {
                const st = await api<GroupState>(`/group-calls/${call.call_uuid}/ping`, { method: 'POST' });
                const present = new Set(st.participants.map((p) => p.id));
                peers.current.forEach((_, id) => { if (!present.has(id)) closePeer(id); });
            } catch {
                onNotice('You were disconnected from the call.');
                cleanup();
            }
        }, 15_000);
        return () => window.clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [call?.call_uuid]);

    useEffect(() => {
        if (localEl.current && local.current && localEl.current.srcObject !== local.current) localEl.current.srcObject = local.current;
    });

    const toggleMute = () => {
        const next = !muted;
        local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
        setMuted(next);
        peers.current.forEach((_, id) => send(id, { muted: next, camera: !camOff }));
    };
    const toggleCam = () => {
        const next = !camOff;
        local.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
        setCamOff(next);
        peers.current.forEach((_, id) => send(id, { muted, camera: !next }));
    };

    if (ring && !call) {
        return (
            <div role="dialog" aria-label="Incoming group call" className="sheet-in fixed inset-x-3 bottom-24 z-[55] mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-grove p-4 text-white shadow-2xl md:bottom-6">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15"><Users size={24} /></span>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{ring.conversation_name ?? 'Group'}</div>
                    <div className="truncate text-sm text-white/75">{ring.caller.name} started a {ring.type} call</div>
                </div>
                <button className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" onClick={() => { setRing(null); stopRing(); }} aria-label="Ignore"><X size={20} /></button>
                <button className="flex size-11 shrink-0 items-center justify-center rounded-full bg-leaf hover:bg-leaf-dark" disabled={joining}
                    onClick={() => joinGroupCall(ring.call_uuid)} aria-label="Join call">{ring.type === 'video' ? <Video size={20} /> : <Phone size={20} />}</button>
            </div>
        );
    }
    if (!call) return null;

    const video = call.type === 'video';
    const list = Object.values(remotes);
    const count = list.length + 1;
    const cols = count <= 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0b2a21] text-white" role="dialog" aria-modal aria-label={`Group call in ${call.conversation_name ?? 'group'}`}>
            <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+14px)] pb-3">
                <Users size={20} className="shrink-0 text-white/70" />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{call.conversation_name ?? 'Group call'}</div>
                    <div className="text-sm text-white/65 tabular-nums">{timer(new Date(call.started_at).getTime(), now)} · {count} {count === 1 ? 'person' : 'people'}{count === 1 ? ', waiting for others to join' : ''}</div>
                </div>
            </div>
            <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto px-2 pb-2 ${cols}`}>
                <Tile name="You" video={video && !camOff} muted={muted} self>
                    {video && <video ref={localEl} autoPlay playsInline muted className={`h-full w-full -scale-x-100 object-cover ${camOff ? 'hidden' : ''}`} />}
                </Tile>
                {list.map((r) => <RemoteTile key={r.id} r={r} video={video} />)}
            </div>
            <div className="flex justify-center gap-5 px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:gap-8">
                <button className={`${round} ${muted ? 'bg-white text-grove' : 'bg-white/15 hover:bg-white/25'}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
                    {muted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>
                {video && (
                    <button className={`${round} ${camOff ? 'bg-white text-grove' : 'bg-white/15 hover:bg-white/25'}`} onClick={toggleCam} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={camOff}>
                        {camOff ? <VideoOff size={24} /> : <Video size={24} />}
                    </button>
                )}
                <button className={`${round} bg-sos hover:bg-sos-dark`} onClick={leave} aria-label="Leave call"><PhoneOff size={24} /></button>
            </div>
        </div>
    );
}

function Tile({ name, video, muted, self = false, state, children }: { name: string; video: boolean; muted?: boolean; self?: boolean; state?: string; children?: React.ReactNode }) {
    return (
        <div className="relative flex min-h-36 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06]">
            {children}
            {!video && <Avatar name={self ? 'You' : name} size={72} />}
            <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium">
                {muted && <MicOff size={13} className="shrink-0" />}
                <span className="truncate">{name}</span>
                {state && state !== 'connected' && <span className="shrink-0 text-white/60">· {state === 'connecting' || state === 'new' ? 'connecting' : state}</span>}
            </div>
        </div>
    );
}

function RemoteTile({ r, video }: { r: Remote; video: boolean }) {
    const el = useRef<HTMLVideoElement>(null);
    useEffect(() => { if (el.current && r.stream && el.current.srcObject !== r.stream) el.current.srcObject = r.stream; }, [r.stream]);
    const showVideo = video && r.camera !== false && !!r.stream;
    return (
        <Tile name={r.name} video={showVideo} muted={r.muted} state={r.state}>
            {/* The element also plays their sound, so it stays even when their camera is off. */}
            <video ref={el} autoPlay playsInline className={`h-full w-full object-cover ${showVideo ? '' : 'absolute size-px opacity-0'}`} />
        </Tile>
    );
}
