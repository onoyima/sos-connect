import { createInertiaApp, router } from '@inertiajs/react';
import { applyFavicon } from '@/lib/favicon';
import type { Branding } from '@/types';
import { guardHistory, sessionEnded } from '@/lib/session';
import { createRoot } from 'react-dom/client';

createInertiaApp({
    title: (title) => (title ? `${title} · SOS Connect` : 'SOS Connect'),
    // Each page is its own small file, loaded when first opened (the first screen appears much sooner on slow networks).
    resolve: (name) => {
        const pages = import.meta.glob('./pages/**/*.tsx');
        const load = pages[`./pages/${name}.tsx`];
        if (!load) throw new Error(`Page not found: ${name}`);
        return load() as never;
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
        applyFavicon((props.initialPage.props as { branding?: Branding }).branding);
        router.on('navigate', (e) => applyFavicon((e.detail.page.props as { branding?: Branding }).branding));
        // The opening screen stays until the chats are loaded (the chats page says when); other pages are ready at once.
        if (props.initialPage.component !== 'Chats/Index') requestAnimationFrame(() => (window as { __sosReady?: () => void }).__sosReady?.());
    },
    progress: { color: '#1e7b57' },
});

// A page request that comes back as "signed out" or "expired" (instead of a page) goes straight to sign-in,
// rather than showing an error box.
router.on('invalid', (event) => {
    const status = event.detail.response.status;
    if (status === 401 || status === 419) {
        event.preventDefault();
        sessionEnded();
    }
});
guardHistory();
