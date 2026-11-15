/**
 * Face tracking for face capture, using Google's MediaPipe Face Landmarker (runs on the device; nothing is sent
 * anywhere while tracking). Gives 478 face points per frame plus eye and mouth scores, from which we work out
 * where the person is looking, whether they blink or open their mouth, and whether the photo is good enough.
 */
import type { FaceLandmarker as FL, NormalizedLandmark } from '@mediapipe/tasks-vision';

const LOCAL_MODEL = '/mediapipe/face_landmarker.task';
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export async function loadLandmarker(): Promise<FL> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    let model = REMOTE_MODEL;
    try {
        const head = await fetch(LOCAL_MODEL, { method: 'HEAD' });
        if (head.ok) model = LOCAL_MODEL; // kept on this server by `php artisan sos:face-model`
    } catch { /* use Google's copy */ }
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: 'VIDEO',
        numFaces: 2, // to notice a second person in view
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
    });
    try { return await make('GPU'); } catch { return make('CPU'); }
}

export type Frame = {
    faces: number;
    points: NormalizedLandmark[] | null;
    /** Face box in video pixels. */
    box: { x: number; y: number; w: number; h: number } | null;
    /** -0.5 … 0.5: 0 = facing the camera; positive = head turned to the person's left. */
    yaw: number;
    /** Nose position between the eyes and chin (0 … 1); smaller = looking up. Compared with the first front photo. */
    pitch: number;
    /** Head tilt in degrees. */
    roll: number;
    eyesClosed: number;
    mouthOpen: number;
    width: number;
    height: number;
};

export function analyse(result: { faceLandmarks: NormalizedLandmark[][]; faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[] }, width: number, height: number): Frame {
    const faces = result.faceLandmarks.length;
    const empty: Frame = { faces, points: null, box: null, yaw: 0, pitch: 0, roll: 0, eyesClosed: 0, mouthOpen: 0, width, height };
    if (faces !== 1) return empty;
    const p = result.faceLandmarks[0];
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const q of p) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; }
    const L = p[234], R = p[454], nose = p[1], eyeR = p[33], eyeL = p[263], chin = p[152];
    const yaw = (nose.x - L.x) / Math.max(1e-6, R.x - L.x) - 0.5;
    const eyeY = (eyeR.y + eyeL.y) / 2;
    const pitch = (nose.y - eyeY) / Math.max(1e-6, chin.y - eyeY);
    const roll = (Math.atan2((eyeL.y - eyeR.y) * height, (eyeL.x - eyeR.x) * width) * 180) / Math.PI;
    const shapes = new Map((result.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]));
    return {
        faces, points: p, width, height, yaw, pitch, roll,
        box: { x: minX * width, y: minY * height, w: (maxX - minX) * width, h: (maxY - minY) * height },
        eyesClosed: ((shapes.get('eyeBlinkLeft') ?? 0) + (shapes.get('eyeBlinkRight') ?? 0)) / 2,
        mouthOpen: shapes.get('jawOpen') ?? 0,
    };
}

/** Approximate head angles in degrees, for the record. */
export function degrees(f: Frame, pitchBase: number) {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return {
        yaw: Math.round((Math.asin(clamp(f.yaw * 2)) * 180) / Math.PI),
        pitch: Math.round((Math.asin(clamp((pitchBase - f.pitch) * 2.4)) * 180) / Math.PI),
        roll: Math.round(f.roll),
    };
}

/** Brightness (0-255) and sharpness (variance of the Laplacian) of the face, from a small grey copy. */
export function lightAndSharpness(video: HTMLVideoElement, box: NonNullable<Frame['box']>, scratch: HTMLCanvasElement) {
    const W = 128, H = Math.max(1, Math.round((box.h / box.w) * W));
    scratch.width = W; scratch.height = H;
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0; i < W * H; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; g[i] = v; sum += v; }
    let n = 0, mean = 0, m2 = 0;
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
            n++; const delta = lap - mean; mean += delta / n; m2 += delta * (lap - mean);
        }
    }
    return { brightness: sum / (W * H), sharpness: n > 1 ? m2 / (n - 1) : 0 };
}

/**
 * The photo that is kept: the real (not mirrored) camera picture, cropped 3:4 around the head with room for hair,
 * ears and shoulders, at the camera's full resolution (never enlarged). Face points are given relative to it.
 */
export async function cropPhoto(video: HTMLVideoElement, f: Frame, canvas: HTMLCanvasElement): Promise<{ blob: Blob; points: number[][]; width: number; height: number }> {
    const box = f.box!;
    const W = f.width, H = f.height;
    let ch = Math.min(H, box.h * 2.1);
    let cw = (ch * 3) / 4;
    if (cw > W) { cw = W; ch = (cw * 4) / 3; }
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2 - box.h * 0.08;
    const sx = Math.max(0, Math.min(W - cw, cx - cw / 2));
    const sy = Math.max(0, Math.min(H - ch, cy - ch / 2));
    const outH = Math.round(Math.min(ch, 1280));
    const outW = Math.round((outH * 3) / 4);
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, outW, outH);
    const blob: Blob = await new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('No photo'))), 'image/jpeg', 0.93));
    const points = (f.points ?? []).map((q) => [(q.x * W - sx) / cw, (q.y * H - sy) / ch, q.z]);
    return { blob, points, width: outW, height: outH };
}
