import * as Crypto from 'expo-crypto';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { api } from '@/lib/api';
import { emit, on } from '@/lib/events';
import { AppState } from 'react-native';
import { loadIdentity } from '@/mesh/identity';
import { MeshManager } from '@/mesh/MeshManager';
import { SyncEngine } from '@/sync/SyncEngine';
import { realtimeFast } from '@/sync/realtime';

type Kind = 'voice' | 'video';
type Phase = 'idle' | 'ringing-in' | 'calling' | 'ringing-out' | 'connecting' | 'connected';
type Call = { uuid: string; type: Kind; peer: { id: number; name: string }; direction: 'in' | 'out'; via: 'online' | 'lan' };

export type GroupInfo = { uuid: string; type: Kind; conversationId: number; name: string | null; startedAt: string };
export type GroupRemote = { id: number; name: string; stream: MediaStream | null; muted?: boolean; camera?: boolean; state: string };
export type GroupRing = { call_uuid: string; type: Kind; conversation_id: number; conversation_name: string | null; caller: { id: number; name: string } };
type GroupState = { call_uuid: string; type: Kind; conversation_id: number; conversation_name: string | null; started_at: string; participants: { id: number; name: string }[] };

type CallState = {
    phase: Phase; call: Call | null; local: MediaStream | null; remote: MediaStream | null; muted: boolean; cameraOff: boolean; peerCameraOff: boolean;
    connectedAt: number | null;
    start: (peer: { id: number; name: string }, type: Kind) => Promise<void>;
    accept: () => Promise<void>; hangUp: () => void; toggleMute: () => void; toggleCamera: () => void; switchCamera: () => void;
    // Group calls
    group: GroupInfo | null; remotes: GroupRemote[]; ring: GroupRing | null;
    startGroup: (conversationId: number, type: Kind) => Promise<void>; joinGroup: (uuid: string) => Promise<void>; leaveGroup: () => void; dismissRing: () => void;
};

const Ctx = createContext<CallState | null>(null);

const VIDEO = { facingMode: 'user', width: 640, height: 480, frameRate: 24 };

/**
 * Calls.
 *  - One-to-one, over two signalling paths: online through the server (Reverb + TURN), or straight to the other
 *    phone over a shared Wi-Fi when there's no internet.
 *  - Group calls (online): every phone connects to every other one. Whoever joins sends an offer to each person
 *    already in the call; those already there only answer.
 * Every handler reads the CURRENT call from a ref, so no handler ever acts on a stale "idle" state.
 */
export function CallProvider({ children }: { children: ReactNode }) {
    const [phase, setPhaseState] = useState<Phase>('idle');
    const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
    const [call, setCallState] = useState<Call | null>(null);
    const [local, setLocal] = useState<MediaStream | null>(null);
    const [remote, setRemote] = useState<MediaStream | null>(null);
    const [muted, setMuted] = useState(false);
    const [cameraOff, setCameraOff] = useState(false);
    const [peerCameraOff, setPeerCameraOff] = useState(false);
    const [connectedAt, setConnectedAt] = useState<number | null>(null);
    const callRef = useRef<Call | null>(null);
    const pc = useRef<RTCPeerConnection | null>(null);
    const pendingIce = useRef<any[]>([]);
    const localRef = useRef<MediaStream | null>(null);
    const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const phaseRef = useRef<Phase>('idle');
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSid = useRef(0);
    const doneSids = useRef(new Set<number>());
    const offered = useRef(false);
    const handled = useRef(new Set<string>()); // calls already shown (a repeat from polling is ignored)

    // Group call state
    const [group, setGroupState] = useState<GroupInfo | null>(null);
    const [remoteMap, setRemoteMap] = useState<Record<number, GroupRemote>>({});
    const [ring, setRing] = useState<GroupRing | null>(null);
    const groupRef = useRef<GroupInfo | null>(null);
    const peers = useRef(new Map<number, { pc: RTCPeerConnection; ice: any[] }>());
    const iceServers = useRef<any[]>([]);
    const ringClear = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Without the websocket, calls need the server checked every second for the other side's messages.
    const setCall = (c: Call | null) => { callRef.current = c; setCallState(c); realtimeFast(!!c || !!groupRef.current); };
    const setGroup = (g: GroupInfo | null) => { groupRef.current = g; setGroupState(g); realtimeFast(!!g || !!callRef.current); };
    const busy = () => !!callRef.current || !!groupRef.current;

    const send = async (kind: 'incoming' | 'state' | 'signal', body: Record<string, unknown>) => {
        const c = callRef.current;
        if (!c) return;
        if (c.via === 'lan') {
            const me = await loadIdentity();
            MeshManager.sendCallSignal(c.peer.id, { kind, call_uuid: c.uuid, ...(kind === 'incoming' ? { type: c.type, caller: { id: me?.userId, name: me?.name } } : {}), ...body });
        } else if (kind === 'state') {
            api(`/calls/${c.uuid}/state`, { body: { action: body.action } }).catch(() => {});
        } else if (kind === 'signal') {
            api(`/calls/${c.uuid}/signal`, { body: { data: body.data } }).catch(() => {});
        }
    };

    const stopLocal = () => {
        localRef.current?.getTracks().forEach((t) => t.stop());
        localRef.current = null;
        setLocal(null);
        setMuted(false);
        setCameraOff(false);
    };

    const cleanup = () => {
        if (ringTimer.current) clearTimeout(ringTimer.current);
        if (pollTimer.current) clearTimeout(pollTimer.current);
        pollTimer.current = null;
        lastSid.current = 0;
        doneSids.current.clear();
        offered.current = false;
        pc.current?.close();
        pc.current = null;
        stopLocal();
        setRemote(null);
        pendingIce.current = [];
        setCall(null);
        setPhase('idle');
        setPeerCameraOff(false);
        setConnectedAt(null);
    };

    const getMedia = async (type: Kind) => {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: type === 'video' ? VIDEO : false });
        localRef.current = stream;
        setLocal(stream);
        return stream;
    };

    const createPeer = async (type: Kind, via: 'online' | 'lan') => {
        const servers = via === 'online' ? (await api<{ iceServers: any[] }>('/calls/ice-servers').catch(() => ({ iceServers: [] }))).iceServers : [];
        const peer = new RTCPeerConnection({ iceServers: servers });
        const stream = await getMedia(type);
        stream.getTracks().forEach((t) => peer.addTrack(t, stream));
        (peer as any).addEventListener('icecandidate', (e: any) => e.candidate && send('signal', { data: { candidate: e.candidate.toJSON?.() ?? e.candidate } }));
        (peer as any).addEventListener('track', (e: any) => e.streams?.[0] && setRemote(e.streams[0]));
        (peer as any).addEventListener('connectionstatechange', () => {
            if (peer.connectionState === 'connected') { setPhase('connected'); setConnectedAt((t) => t ?? Date.now()); }
            if (peer.connectionState === 'failed') { send('state', { action: 'failed', status: 'failed' }); cleanup(); }
        });
        pc.current = peer;
        return peer;
    };

    const flushIce = async () => {
        for (const c of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    };

    useEffect(() => on('callSignal', async ({ from, data, via }) => {
        const c = callRef.current;
        if (data.kind === 'incoming') {
            if (c || groupRef.current) { if (via === 'lan') MeshManager.sendCallSignal(from, { kind: 'state', call_uuid: data.call_uuid, status: 'busy' }); return; }
            if (handled.current.has(data.call_uuid)) return;
            handled.current.add(data.call_uuid);
            setCall({ uuid: data.call_uuid, type: data.type, peer: data.caller, direction: 'in', via });
            setPhase('ringing-in');
            if (via === 'online') {
                api(`/calls/${data.call_uuid}/ringing`, { method: 'POST' }).catch(() => {}); // the caller now hears ringing
                startPolling();
            }
            ringTimer.current = setTimeout(() => cleanup(), 50_000);
            return;
        }
        if (!c || c.uuid !== data.call_uuid) return;
        if (typeof data.sid === 'number') {
            if (doneSids.current.has(data.sid)) return; // already handled (arrived both ways)
            doneSids.current.add(data.sid);
            lastSid.current = Math.max(lastSid.current, data.sid);
        }
        if (data.kind === 'state') {
            const status = data.status ?? data.action;
            if (status === 'ringing' && data.rang && phaseRef.current === 'calling') { setPhase('ringing-out'); return; }
            if ((status === 'answered' || status === 'answer') && c.direction === 'out') {
                if (offered.current) return;
                offered.current = true;
                if (ringTimer.current) clearTimeout(ringTimer.current);
                setPhase('connecting');
                try {
                    const peer = await createPeer(c.type, c.via);
                    const offer = await peer.createOffer({});
                    await peer.setLocalDescription(offer);
                    send('signal', { data: { sdp: offer } });
                } catch { send('state', { action: 'failed', status: 'failed' }); cleanup(); }
            } else if (['rejected', 'reject', 'ended', 'end', 'missed', 'failed', 'busy'].includes(status)) {
                cleanup();
            }
        } else if (data.kind === 'signal') {
            const { sdp, candidate, camera } = data.data ?? {};
            const peer = pc.current;
            if (typeof camera === 'boolean') setPeerCameraOff(!camera);
            if (sdp?.type === 'offer' && peer) {
                await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                await flushIce();
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                send('signal', { data: { sdp: answer } });
            } else if (sdp?.type === 'answer' && peer && !(peer as any).remoteDescription) {
                await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                await flushIce();
            } else if (candidate) {
                if (peer?.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
                else pendingIce.current.push(candidate);
            }
        }
    }), []);

    const start = async (peer: { id: number; name: string }, type: Kind) => {
        if (busy()) throw new Error('Finish your current call first.');
        const via: 'online' | 'lan' = SyncEngine.online ? 'online' : MeshManager.hasLanPeer(peer.id) ? 'lan' : 'online';
        if (via === 'online' && !SyncEngine.online) throw new Error(`${peer.name} isn't on your Wi-Fi and you're offline. Send a message instead — it will reach them through nearby phones.`);
        const uuid = Crypto.randomUUID();
        setCall({ uuid, type, peer, direction: 'out', via });
        setPhase(via === 'online' ? 'calling' : 'ringing-out'); // online: "calling" until it's on their screen
        if (via === 'online') {
            try {
                await api('/calls', { body: { callee_id: peer.id, type, call_uuid: uuid } });
                startPolling();
            } catch (e) {
                cleanup();
                throw (e as { status?: number }).status === 409 ? new Error(`${peer.name} is on another call.`) : e;
            }
        } else {
            send('incoming', {});
        }
        ringTimer.current = setTimeout(() => { send('state', { action: 'missed', status: 'missed' }); cleanup(); }, 50_000);
    };

    /**
     * Online calls don't depend on the live connection alone: until connected, the server is asked every second
     * where the call stands and for setup messages kept there (then every 4 seconds, to notice a hang-up).
     */
    function startPolling() {
        if (pollTimer.current) clearTimeout(pollTimer.current);
        const tick = async () => {
            const c = callRef.current;
            if (!c || c.via !== 'online') return;
            try {
                const r = await api<{ status: string; rang: boolean; signals: { id: number; data: any }[] }>(`/calls/${c.uuid}/poll?after=${lastSid.current}`);
                for (const s of r.signals) emit('callSignal', { from: 0, data: { kind: 'signal', call_uuid: c.uuid, data: s.data, sid: s.id }, via: 'online' });
                emit('callSignal', { from: 0, data: { kind: 'state', call_uuid: c.uuid, status: r.status, rang: r.rang }, via: 'online' });
            } catch { /* a moment offline: try again */ }
            if (callRef.current?.uuid === c.uuid) pollTimer.current = setTimeout(tick, phaseRef.current === 'connected' ? 4000 : 1000);
        };
        pollTimer.current = setTimeout(tick, 700);
    }

    const accept = async () => {
        const c = callRef.current;
        if (!c) return;
        if (ringTimer.current) clearTimeout(ringTimer.current);
        setPhase('connecting');
        try {
            await createPeer(c.type, c.via); // microphone ready BEFORE the caller sends its offer
            send('state', { action: 'answer', status: 'answered' });
        } catch { send('state', { action: 'failed', status: 'failed' }); cleanup(); }
    };

    const hangUp = () => {
        const action = phaseRef.current === 'ringing-in' ? 'reject' : 'end';
        send('state', { action, status: action === 'reject' ? 'rejected' : 'ended' });
        cleanup();
    };

    // Opened from a call notification (or brought back to the front): a call still ringing for me shows at once.
    useEffect(() => {
        const check = () => {
            if (busy() || !SyncEngine.online) return;
            api<{ call: { call_uuid: string; type: Kind; caller: { id: number; name: string } } | null }>('/calls/pending').then((r) => {
                if (r.call && !busy()) emit('callSignal', { from: r.call.caller.id, data: { kind: 'incoming', ...r.call }, via: 'online' });
            }).catch(() => {});
        };
        check();
        const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
        return () => sub.remove();
    }, []);

    // ---- Group calls -------------------------------------------------------------------------------

    const patchRemote = (id: number, p: Partial<GroupRemote>) => setRemoteMap((r) => (r[id] || p.name
        ? { ...r, [id]: { ...({ id, name: 'Member', stream: null, state: 'connecting' } as GroupRemote), ...r[id], ...p } } : r));
    const groupSend = (to: number, data: unknown) => groupRef.current && api(`/group-calls/${groupRef.current.uuid}/signal`, { body: { to, data } }).catch(() => {});

    const closePeer = (id: number) => {
        peers.current.get(id)?.pc.close();
        peers.current.delete(id);
        setRemoteMap((r) => { const n = { ...r }; delete n[id]; return n; });
    };

    const groupCleanup = () => {
        peers.current.forEach((p) => p.pc.close());
        peers.current.clear();
        stopLocal();
        setRemoteMap({});
        setGroup(null);
    };

    const peerFor = (id: number, name?: string) => {
        const have = peers.current.get(id);
        if (have) return have.pc;
        const peer = new RTCPeerConnection({ iceServers: iceServers.current });
        localRef.current?.getTracks().forEach((t) => peer.addTrack(t, localRef.current!));
        (peer as any).addEventListener('icecandidate', (e: any) => e.candidate && groupSend(id, { candidate: e.candidate.toJSON?.() ?? e.candidate }));
        (peer as any).addEventListener('track', (e: any) => e.streams?.[0] && patchRemote(id, { stream: e.streams[0] }));
        (peer as any).addEventListener('connectionstatechange', () => {
            patchRemote(id, { state: peer.connectionState });
            if (peer.connectionState === 'failed') closePeer(id);
        });
        peers.current.set(id, { pc: peer, ice: [] });
        patchRemote(id, { name: name ?? 'Member', state: 'connecting' });
        return peer;
    };

    const enterGroup = async (fetchState: () => Promise<GroupState>) => {
        if (busy()) throw new Error('Finish your current call first.');
        if (!SyncEngine.online) throw new Error('Group calls need internet.');
        setRing(null);
        const st = await fetchState();
        try {
            iceServers.current = (await api<{ iceServers: any[] }>('/calls/ice-servers').catch(() => ({ iceServers: [] }))).iceServers;
            await getMedia(st.type);
            setGroup({ uuid: st.call_uuid, type: st.type, conversationId: st.conversation_id, name: st.conversation_name, startedAt: st.started_at });
            const me = await loadIdentity();
            for (const p of st.participants.filter((x) => x.id !== me?.userId)) {
                const peer = peerFor(p.id, p.name);
                const offer = await peer.createOffer({});
                await peer.setLocalDescription(offer);
                groupSend(p.id, { sdp: offer });
            }
        } catch (e) {
            api(`/group-calls/${st.call_uuid}/leave`, { method: 'POST' }).catch(() => {});
            groupCleanup();
            throw e;
        }
    };

    const startGroup = (conversationId: number, type: Kind) =>
        enterGroup(() => api<GroupState>(`/conversations/${conversationId}/call`, { body: { type } }));
    const joinGroup = (uuid: string) => enterGroup(() => api<GroupState>(`/group-calls/${uuid}/join`, { method: 'POST' }));
    const leaveGroup = () => {
        const g = groupRef.current;
        if (g) api(`/group-calls/${g.uuid}/leave`, { method: 'POST' }).catch(() => {});
        groupCleanup();
    };

    useEffect(() => on('groupCall', async ({ kind, data }) => {
        const g = groupRef.current;
        if (kind === 'ring') {
            if (busy()) return;
            setRing(data);
            if (ringClear.current) clearTimeout(ringClear.current);
            ringClear.current = setTimeout(() => setRing(null), 40_000);
            return;
        }
        if (!g || g.uuid !== data.call_uuid) return;
        if (kind === 'joined') patchRemote(data.user.id, { name: data.user.name, state: 'connecting' });
        else if (kind === 'left') closePeer(data.user_id);
        else if (kind === 'signal') {
            const { sdp, candidate, muted: m, camera } = data.data ?? {};
            if (typeof m === 'boolean' || typeof camera === 'boolean') patchRemote(data.from, { muted: m, camera });
            if (sdp?.type === 'offer') {
                const peer = peerFor(data.from);
                await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of peers.current.get(data.from)?.ice.splice(0) ?? []) await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                groupSend(data.from, { sdp: answer });
            } else if (sdp?.type === 'answer') {
                const p = peers.current.get(data.from);
                if (p) {
                    await p.pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
                }
            } else if (candidate) {
                const p = peers.current.get(data.from) ?? (peerFor(data.from), peers.current.get(data.from)!);
                if (p.pc.remoteDescription) await p.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
                else p.ice.push(candidate);
            }
        }
    }), []);

    // "Still here" every 15 seconds; drops anyone the server no longer counts as in the call.
    useEffect(() => {
        if (!group) return;
        const t = setInterval(async () => {
            try {
                const st = await api<GroupState>(`/group-calls/${group.uuid}/ping`, { method: 'POST' });
                const present = new Set(st.participants.map((p) => p.id));
                peers.current.forEach((_, id) => { if (!present.has(id)) closePeer(id); });
            } catch (e) {
                if ((e as { status?: number }).status === 410 || (e as { status?: number }).status === 403) groupCleanup();
            }
        }, 15_000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group?.uuid]);

    // ---- Controls shared by both kinds of call ----------------------------------------------------

    const broadcastMedia = (m: boolean, cam: boolean) => {
        if (groupRef.current) peers.current.forEach((_, id) => groupSend(id, { muted: m, camera: cam }));
        else if (callRef.current) send('signal', { data: { camera: cam } });
    };
    const toggleMute = () => {
        const next = !muted;
        localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
        setMuted(next);
        broadcastMedia(next, !cameraOff);
    };
    const toggleCamera = () => {
        const next = !cameraOff;
        localRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
        setCameraOff(next);
        broadcastMedia(muted, !next);
    };
    const switchCamera = () => localRef.current?.getVideoTracks().forEach((t) => (t as any)._switchCamera?.());

    return (
        <Ctx.Provider value={{
            phase, call, local, remote, muted, cameraOff, peerCameraOff, connectedAt, start, accept, hangUp, toggleMute, toggleCamera, switchCamera,
            group, remotes: Object.values(remoteMap), ring, startGroup, joinGroup, leaveGroup, dismissRing: () => setRing(null),
        }}>{children}</Ctx.Provider>
    );
}

export function useCalls() {
    const v = useContext(Ctx);
    if (!v) throw new Error('useCalls must be used inside <CallProvider>');
    return v;
}
