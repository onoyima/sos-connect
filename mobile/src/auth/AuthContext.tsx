import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { RINGS, TONES } from '@/sound/toneDefs';
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
    /** Tones chosen in Settings > Sounds (message, group, call, group_call, request, notice). */
    sounds?: Record<string, string>;
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
        // SOS alarms: the siren, through Do Not Disturb, played like an alarm clock, shown in full on the lock screen.
        await Notifications.setNotificationChannelAsync('sos-siren', {
            name: 'SOS alarm', description: 'Rings with a siren when someone near you presses SOS.',
            importance: Notifications.AndroidImportance.MAX, bypassDnd: true, sound: 'siren.wav', enableVibrate: true,
            vibrationPattern: [0, 900, 300, 900, 300, 900, 300, 900], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
        });
        await Notifications.setNotificationChannelAsync('sos', { name: 'SOS alerts', importance: Notifications.AndroidImportance.MAX, bypassDnd: true, sound: 'default', vibrationPattern: [0, 500, 300, 500, 300, 500] });
        await Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: Notifications.AndroidImportance.DEFAULT });
        // One channel per tone people can choose (Settings > Sounds): the server sends each alert on the person's chosen one.
        for (const id of Object.keys(TONES)) {
            await Notifications.setNotificationChannelAsync(`tone-${id}`, { name: `Alerts: ${id}`, importance: Notifications.AndroidImportance.HIGH, sound: `tone_${id}.wav`, vibrationPattern: [0, 250] });
        }
        for (const id of Object.keys(RINGS)) {
            await Notifications.setNotificationChannelAsync(`ring-${id}`, { name: `Calls: ${id}`, importance: Notifications.AndroidImportance.MAX, sound: `ring_${id}.wav`,
                vibrationPattern: [0, 700, 500, 700], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC });
        }
        await Notifications.setNotificationChannelAsync('tone-silent', { name: 'Alerts: silent', importance: Notifications.AndroidImportance.DEFAULT, sound: null });
        await Notifications.setNotificationChannelAsync('ring-silent', { name: 'Calls: vibrate only', importance: Notifications.AndroidImportance.MAX, sound: null, vibrationPattern: [0, 700, 500, 700] });
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } })?.eas?.projectId;
        return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    } catch {
        return null;
    }
}
