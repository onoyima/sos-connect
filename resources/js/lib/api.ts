import { sessionEnded } from './session';

/** Same-origin JSON client. The session cookie + XSRF token authenticate the web app against /api. */
function xsrf(): string {
    const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
    const res = await fetch(`/api${path}`, {
        method: options.method ?? (options.body || options.form ? 'POST' : 'GET'),
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-XSRF-TOKEN': xsrf(),
            'X-Requested-With': 'XMLHttpRequest',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401 || res.status === 419) {
        sessionEnded((data as { signed_out?: string } | null)?.signed_out); // signed out: sign in again rather than failing silently
    }
    if (!res.ok) throw new ApiError(res.status, (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`);
    return data as T;
}

/** crypto.randomUUID only exists on https/localhost; fall back so the app also works over plain http on a campus LAN. */
export const uuid = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function fileUrl(path: string): string {
    return `/api/files/${path.replace(/^uploads\//, '')}`;
}
