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
let checking = false;
let warned = false;
const BOUNCE = 'sos.signInBounce';

/**
 * why: 'replaced' = opened on another browser, 'phone' = signed out from the phone, otherwise the session ran out.
 *
 * A plain 401 from /api is double-checked against the page session first. If the page session is still fine,
 * the API is refusing it because of server set-up (not because the person was signed out), and going to the
 * sign-in page would only bounce straight back here, over and over. So we stay put and say so in the console.
 */
export function sessionEnded(why?: string | null) {
    if (leaving) return;
    if (why === 'replaced' || why === 'phone') { leave(why); return; }
    if (checking) return;
    checking = true;
    fetch('/session', { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
        .then(async (res) => {
            if (res.status === 401 || res.status === 419) {
                const data = await res.json().catch(() => null) as { signed_out?: string } | null;
                leave(data?.signed_out ?? null);
            } else if (res.ok && !warned) {
                warned = true;
                console.error('[SOS Connect] The API refused this signed-in session (401) but the page session is valid. '
                    + 'Check APP_URL / SANCTUM_STATEFUL_DOMAINS and SESSION_DOMAIN on the server. Not signing out.');
            }
        })
        .catch(() => { /* offline: try again later */ })
        .finally(() => { window.setTimeout(() => { checking = false; }, 30_000); });
}

function leave(why: string | null) {
    // Never loop: if we were sent to sign-in moments ago and are back already, stop here.
    let last = 0;
    try { last = Number(sessionStorage.getItem(BOUNCE) ?? 0); } catch { /* private mode */ }
    if (Date.now() - last < 15_000) { console.error('[SOS Connect] Sign-in keeps bouncing back; not redirecting again.'); return; }
    try { sessionStorage.setItem(BOUNCE, String(Date.now())); sessionStorage.setItem(FLAG, '1'); } catch { /* private mode */ }
    leaving = true;
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
