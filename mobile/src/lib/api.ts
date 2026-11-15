import * as SecureStore from 'expo-secure-store';
import { config } from '@/config';
import { emit } from './events';

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const TOKEN = 'sos.token';
let cachedToken: string | null | undefined;

export async function getToken() {
    if (cachedToken === undefined) cachedToken = await SecureStore.getItemAsync(TOKEN);
    return cachedToken;
}

export async function setToken(token: string | null) {
    cachedToken = token;
    if (token) await SecureStore.setItemAsync(TOKEN, token);
    else await SecureStore.deleteItemAsync(TOKEN);
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData; timeoutMs?: number } = {}): Promise<T> {
    const token = await getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
    try {
        const res = await fetch(`${config.apiUrl}/api${path}`, {
            method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
            headers: {
                Accept: 'application/json',
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        // The server no longer accepts this sign-in (expired, revoked, account removed): sign out cleanly.
        if (res.status === 401 && token && path !== '/auth/logout') emit('unauthorized', { reason: (data as { signed_out?: string } | null)?.signed_out ?? null });
        if (!res.ok) throw new ApiError(res.status, (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`);
        return data as T;
    } finally {
        clearTimeout(timer);
    }
}
