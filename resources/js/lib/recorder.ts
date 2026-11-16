/**
 * Records a call on this device: both voices mixed together (and the other person's video in a video call), saved
 * as a file to this phone or computer when recording stops. Nothing is uploaded. The other person is told while
 * the recording runs (the call screen shows it).
 */
export type CallRecorder = { stop: () => Promise<void> };

const pick = (video: boolean) => {
    const types = video
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
};

export const canRecord = () => typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined';

export function recordCall(local: MediaStream | null, remote: MediaStream | null, withVideo: boolean, name: string): CallRecorder {
    const ctx = new AudioContext();
    const mix = ctx.createMediaStreamDestination();
    for (const s of [local, remote]) {
        if (s && s.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(mix);
    }
    const videoTrack = withVideo ? remote?.getVideoTracks()[0] : undefined;
    const stream = new MediaStream([...(videoTrack ? [videoTrack] : []), ...mix.stream.getAudioTracks()]);
    const type = pick(!!videoTrack);
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.start(1000); // a piece every second, so a dropped call still keeps what was recorded

    return {
        stop: () => new Promise<void>((done) => {
            const save = () => {
                const mime = rec.mimeType || type || (videoTrack ? 'video/webm' : 'audio/webm');
                const blob = new Blob(parts, { type: mime });
                if (blob.size) {
                    const ext = mime.includes('mp4') ? (videoTrack ? 'mp4' : 'm4a') : mime.includes('ogg') ? 'ogg' : 'webm';
                    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `Call with ${name.replace(/[\\/:*?"<>|]/g, '')} ${stamp}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
                }
                ctx.close().catch(() => {});
                done();
            };
            if (rec.state === 'inactive') return save();
            rec.onstop = save;
            rec.stop();
        }),
    };
}
