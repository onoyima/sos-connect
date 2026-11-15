import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { kvGet, kvSet, wipeAll } from '@/db/database';
import { api, getToken, setToken } from '@/lib/api';
import { on } from '@/lib/events';
import { clearIdentity, loadIdentity, registerDevice } from '@/mesh/identity';
import { MeshManager } from '@/mesh/MeshManager';
import { SyncEngine } from '@/sync/SyncEngine';

export type Me = {
    id: number; name: string; title: string | null; member_type: string; modules?: Record<string, boolean>; identifier: string | null;
    department: string | null; faculty?: string | null; level: number | null; programme?: string | null; residence?: string | null;
    children?: { name: string; relationship: string | null; department: string | null; level: number | null }[];
    permissions: string[]; needs_policy_acceptance: boolean;
    /** Face capture switched on for the institution (null = off), required, and done by me. */
    face?: { required: boolean; done: boolean } | null;
    /** Institution icon and today's seasonal badge (Christmas, Easter, Eid…). */
    branding?: { favicon: string | null; icon: string | null; season: null | { key: string; label: string; badge: string; accent: string } }; needs_guardian_consent: boolean;
    institution: { id: number; name: string; short_code: string; country: string; security_phone: string | null; emergency_numbers: string[] } | null;
};

type AuthState = {
    status: 'loading' | 'signedOut' | 'ready';
    me: Me | null;
    can: (permission: string) => boolean;
    /** Is this feature switched on by the institution? (unknown = on, so an old cached profile never hides things) */
    has: (module: string) => boolean;
    login: (identifier: string, password: string) => Promise<void>;
    logout: (opts?: { local?: boolean }) => Promise<void>;
    refreshMe: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

const REPLACED_NOTICE = 'Your account was signed in on another phone, so it was signed out here. An account can be open on one phone and one web browser at a time.';

/** A message for the sign-in screen after an automatic sign-out (read once). */
let signOutNotice: string | null = null;
export function takeSignOutNotice(): string | null {
    const n = signOutNotice;
    signOutNotice = null;
    return n;
}

/**
 * ONE shared login state for the whole app (the old app gave each screen its own copy, so the socket
 * never connected after login). A signed-in member can open the app and use the mesh with no internet:
 * the profile, certificate and keys are kept on the phone.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthState['status']>('loading');
    const [me, setMe] = useState<Me | null>(null);

    const startServices = useCallback(async () => {
        await MeshManager.start();
        SyncEngine.start();
        SyncEngine.run();
    }, []);

    useEffect(() => {
        (async () => {
            const [token, identity, cached] = await Promise.all([getToken(), loadIdentity(), kvGet<Me>('me')]);
            if (token && identity && cached) {
                setMe(cached);
                setStatus('ready');
                startServices();
                api<{ user: Me }>('/me').then((r) => { setMe(r.user); kvSet('me', r.user); }).catch(() => {});
            } else {
                setStatus('signedOut');
            }
        })();
    }, [startServices]);

    const login = useCallback(async (identifier: string, password: string) => {
        const r = await api<{ token: string; user: Me }>('/auth/login', { body: { identifier, password, device_name: 'phone' } });
        await setToken(r.token);
        await registerDevice(await pushToken());
        await kvSet('me', r.user);
        setMe(r.user);
        setStatus('ready');
        await startServices();
    }, [startServices]);

    const logout = useCallback(async (opts: { local?: boolean } = {}) => {
        if (!opts.local) {
            try { await api('/auth/logout', { method: 'POST' }); } catch { /* offline: still sign out locally */ }
        }
        MeshManager.stop();
        SyncEngine.stop();
        await Promise.all([wipeAll(), clearIdentity(), setToken(null)]);
        setMe(null);
        setStatus('signedOut');
    }, []);

    const signingOut = useRef(false);
    // The server said this sign-in is no longer valid: clear the phone and go back to sign-in with a message.
    const signOutHere = useCallback((notice: string) => {
        if (signingOut.current) return;
        signingOut.current = true;
        signOutNotice = notice;
        logout({ local: true }).finally(() => { signingOut.current = false; });
    }, [logout]);
    useEffect(() => on('unauthorized', ({ reason }) => signOutHere(reason === 'replaced'
        ? REPLACED_NOTICE
        : 'Your session ended, so you were signed out to keep your account safe. Please sign in again.')), [signOutHere]);
    // One phone at a time: the moment the account signs in on another phone, this one signs out.
    useEffect(() => on('sessionReplaced', async ({ device, keep }) => {
        if (device !== 'phone') return;
        const token = await getToken();
        const mine = token ? Number(token.split('|')[0]) : null;
        if (mine && keep !== null && Number(keep) !== mine) signOutHere(REPLACED_NOTICE);
    }), [signOutHere]);

    const refreshMe = useCallback(async () => {
        const r = await api<{ user: Me }>('/me');
        setMe(r.user);
        await kvSet('me', r.user);
    }, []);

    const value = useMemo<AuthState>(() => ({
        status, me, login, logout, refreshMe, can: (p) => !!me?.permissions.includes(p),
        has: (m) => m === 'sos' || me?.modules?.[m] !== false,
    }), [status, me, login, logout, refreshMe]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
    const v = useContext(Ctx);
    if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
    return v;
}

async function pushToken(): Promise<string | null> {
    try {
        const perm = await Notifications.requestPermissionsAsync();
        if (!perm.granted) return null;
        await Notifications.setNotificationChannelAsync('sos', { name: 'SOS alerts', importance: Notifications.AndroidImportance.MAX, bypassDnd: true, sound: 'default', vibrationPattern: [0, 500, 300, 500, 300, 500] });
        await Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: Notifications.AndroidImportance.DEFAULT });
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } })?.eas?.projectId;
        return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    } catch {
        return null;
    }
}
