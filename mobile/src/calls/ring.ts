import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { Vibration } from 'react-native';
import { toBase64 } from '@/lib/base64';

/**
 * Call sounds without shipping audio files: a ringtone (incoming) and a ringback tone (calling someone) are
 * generated once as small WAV files in the app's cache, then looped. Incoming calls also vibrate.
 */
let player: AudioPlayer | null = null;
const files: Partial<Record<'incoming' | 'outgoing', string>> = {};

/** 16-bit mono PCM WAV of tone bursts: [frequencies, seconds on, seconds off]. */
function wav(pattern: [number[], number, number][], rate = 16000): Uint8Array {
    const samples: number[] = [];
    for (const [freqs, on, off] of pattern) {
        const n = Math.floor(on * rate);
        for (let i = 0; i < n; i++) {
            const fade = Math.min(1, i / (rate * 0.02), (n - i) / (rate * 0.02));
            const v = freqs.reduce((sum, f) => sum + Math.sin((2 * Math.PI * f * i) / rate), 0) / freqs.length;
            samples.push(v * 0.5 * fade);
        }
        for (let i = 0; i < Math.floor(off * rate); i++) samples.push(0);
    }
    const data = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(data.buffer);
    const text = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
    return data;
}

async function file(kind: 'incoming' | 'outgoing') {
    if (files[kind]) return files[kind]!;
    const path = `${FileSystem.cacheDirectory}sos-${kind}-v1.wav`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
        const pattern: [number[], number, number][] = kind === 'incoming'
            ? [[[440, 480], 0.4, 0.2], [[440, 480], 0.4, 1.6]]
            : [[[425], 1, 3]];
        await FileSystem.writeAsStringAsync(path, toBase64(wav(pattern)), { encoding: FileSystem.EncodingType.Base64 });
    }
    files[kind] = path;
    return path;
}

export async function startRing(kind: 'incoming' | 'outgoing') {
    stopRing();
    if (kind === 'incoming') Vibration.vibrate([0, 700, 500, 700, 1600], true);
    try {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: true });
        player = createAudioPlayer({ uri: await file(kind) });
        player.loop = true;
        player.volume = kind === 'incoming' ? 1 : 0.4;
        player.play();
    } catch { /* no sound: the call screen and vibration still show it */ }
}

export function stopRing() {
    Vibration.cancel();
    try { player?.pause(); player?.remove(); } catch { /* already gone */ }
    player = null;
}
