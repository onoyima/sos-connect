import { router } from '@inertiajs/react';

/**
 * Keeps people from getting stuck on a page after their session has ended.
 *  - signOut(): ends the session and remembers it, so pressing Back can't show private pages again.
 *  - sessionEnded(): sends the person to sign in with a clear message (used when the server answers 401/419).
 *  - watchSession(): checks every few minutes and whenever the tab comes back into view.
 */
const FLAG = 'sos.signedOut';

export function signOut() {
    try { sessionStorage.setItem(FLAG, '1'); } catch { /* private mode */ }
    router.post('/logout', {}, { replace: true });
}

/** Asks "Sign out?" first (the dialog lives in AppLayout). */
export function askSignOut() {
    window.dispatchEvent(new Event('sos:ask-sign-out'));
}

export function signedIn() {
    try { sessionStorage.removeItem(FLAG); } catch { /* private mode */ }
}

let leaving = false;
/** why: 'replaced' = opened on another browser, 'phone' = signed out from the phone, otherwise the session ran out. */
export function sessionEnded(why?: string | null) {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem(FLAG, '1'); } catch { /* private mode */ }
    window.location.replace(`/login?${why === 'replaced' || why === 'phone' ? why : 'expired'}=1`);
}

async function check(): Promise<void> {
    try {
        const res = await fetch('/session', { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
        if (res.status === 401 || res.status === 419) {
            const data = await res.json().catch(() => null) as { signed_out?: string } | null;
            sessionEnded(data?.signed_out);
        }
    } catch { /* offline: try again later */ }
}

let watching = false;
export function watchSession() {
    if (watching) return;
    watching = true;
    setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    window.addEventListener('focus', check);
}

/** Back button after signing out: a remembered private page must not come back. */
export function guardHistory() {
    window.addEventListener('popstate', () => {
        let out = false;
        try { out = sessionStorage.getItem(FLAG) === '1'; } catch { /* private mode */ }
        const path = window.location.pathname;
        const isPublic = path === '/login' || path.startsWith('/legal') || path.startsWith('/register-institution') || path.startsWith('/invite/');
        if (out && !isPublic) window.location.replace('/login');
    });
}
