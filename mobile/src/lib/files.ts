import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { config } from '@/config';
import { api, getToken } from './api';

export type Picked = { uri: string; name: string; mime: string; size?: number | null };
export type Uploaded = { path: string; mime: string; size: number };

/** Photos and files are stored on the server and fetched with the member's token; they never travel over the mesh. */
export function fileUrl(path: string): string {
    const [, iid, name] = path.split('/');
    return `${config.apiUrl}/api/files/${iid}/${name}`;
}

export async function authHeaders(): Promise<Record<string, string>> {
    const t = await getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function upload(file: Picked): Promise<Uploaded> {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mime } as unknown as Blob);
    return api<Uploaded>('/uploads', { form, timeoutMs: 120_000 });
}

export async function pickPhoto(camera = false): Promise<Picked | null> {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: false };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mime: a.mimeType ?? 'image/jpeg', size: a.fileSize };
}

export async function pickDocument(): Promise<Picked | null> {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    return { uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream', size: a.size };
}

/** Downloads a file once into the cache and opens the share/open-with sheet. */
export async function openFile(path: string, name: string): Promise<void> {
    const target = `${FileSystem.cacheDirectory}${encodeURIComponent(path.split('/').pop() ?? name)}`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) await FileSystem.downloadAsync(fileUrl(path), target, { headers: await authHeaders() });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { dialogTitle: name });
}

/** Local copy for audio playback (players can't send auth headers on every platform). */
export async function cachedFile(path: string): Promise<string> {
    const target = `${FileSystem.cacheDirectory}${encodeURIComponent(path.split('/').pop() ?? 'file')}`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) await FileSystem.downloadAsync(fileUrl(path), target, { headers: await authHeaders() });
    return target;
}
