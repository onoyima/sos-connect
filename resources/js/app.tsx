import { createInertiaApp, router } from '@inertiajs/react';
import { guardHistory, sessionEnded } from '@/lib/session';
import { createRoot } from 'react-dom/client';

createInertiaApp({
    title: (title) => (title ? `${title} · SOS Connect` : 'SOS Connect'),
    resolve: (name) => {
        const pages = import.meta.glob('./pages/**/*.tsx', { eager: true });
        const page = pages[`./pages/${name}.tsx`];
        if (!page) throw new Error(`Page not found: ${name}`);
        return page as never;
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
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
