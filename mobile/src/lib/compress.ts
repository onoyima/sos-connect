import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import type { Picked } from './files';

/**
 * Makes photos and videos smaller before they are uploaded, the way WhatsApp does:
 *  - photos: longest side at most 1600 px, saved as JPEG at 80% quality (PNGs stay PNG to keep transparency),
 *  - videos: re-encoded to a phone-friendly size and bitrate (react-native-compressor's "auto", modelled on WhatsApp),
 *  - GIFs, voice notes and documents are left exactly as they are.
 * If the smaller version isn't actually smaller, or anything goes wrong, the original is sent.
 */
const MAX_SIDE = 1600;

const sizeOf = (uri: string) => new Promise<{ width: number; height: number }>((ok, no) => Image.getSize(uri, (width, height) => ok({ width, height }), no));
const bytes = async (uri: string) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? (info.size as number) : null;
};

async function compressImage(file: Picked): Promise<Picked> {
    const { width, height } = await sizeOf(file.uri);
    const png = file.mime === 'image/png';
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const actions: ImageManipulator.Action[] = scale < 1 ? [{ resize: width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) } }] : [];
    const out = await ImageManipulator.manipulateAsync(file.uri, actions, { compress: 0.8, format: png ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG });
    const size = await bytes(out.uri);
    const before = file.size ?? (await bytes(file.uri));
    if (size === null || (before !== null && size >= before)) return file;
    return { uri: out.uri, name: file.name.replace(/\.[^.]+$/, '') + (png ? '.png' : '.jpg'), mime: png ? 'image/png' : 'image/jpeg', size };
}

async function compressVideo(file: Picked): Promise<Picked> {
    // Loaded only when needed: the native part exists in the installed app build (not in Expo Go).
    const { Video } = await import('react-native-compressor');
    const uri = await Video.compress(file.uri, { compressionMethod: 'auto' });
    const out = uri.startsWith('file://') ? uri : `file://${uri}`;
    const size = await bytes(out);
    const before = file.size ?? (await bytes(file.uri));
    if (size === null || (before !== null && size >= before)) return file;
    return { uri: out, name: file.name.replace(/\.[^.]+$/, '') + '.mp4', mime: 'video/mp4', size };
}

export async function compressForUpload(file: Picked): Promise<Picked> {
    try {
        if (file.mime.startsWith('image/') && file.mime !== 'image/gif' && file.mime !== 'image/svg+xml') return await compressImage(file);
        if (file.mime.startsWith('video/')) return await compressVideo(file);
    } catch {
        // e.g. an unusual format: send the original rather than nothing
    }
    return file;
}
