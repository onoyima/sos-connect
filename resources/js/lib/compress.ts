/**
 * Makes photos smaller in the browser before they are uploaded, the way WhatsApp does: the longest side becomes at
 * most 1600 px and the photo is saved as JPEG at 80% quality (a 5 MB camera photo becomes about 300 KB and still
 * looks sharp on a phone). Pictures with see-through parts are saved as WebP so the transparency is kept.
 * GIFs, SVGs, videos (shrunk on the server) and documents are left as they are; so is anything that wouldn't get smaller.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    // Look at a grid of points rather than every pixel: fast, and enough to spot a transparent background.
    const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] < 250) return true;
    return false;
}

export async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
    try {
        // imageOrientation: photos taken sideways on a phone come out the right way up.
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size < 300 * 1024) { bitmap.close?.(); return file; } // already small
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return file;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const alpha = file.type !== 'image/jpeg' && hasTransparency(ctx, w, h);
        if (!alpha) { // JPEG has no transparency: paint a white background under the picture first
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
        }
        const type = alpha ? 'image/webp' : 'image/jpeg';
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, QUALITY));
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + (alpha ? '.webp' : '.jpg'), { type, lastModified: Date.now() });
    } catch {
        return file; // e.g. a HEIC photo this browser can't read: send the original
    }
}
