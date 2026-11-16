import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { api } from './api';
import type { SharedProps } from '@/types';

let echo: Echo<'reverb'> | null = null;

/**
 * Realtime over Laravel Reverb. Private channels are signed in through /api/broadcasting/auth with the page's own
 * session (the same way every other request from the page is), and authorised by routes/channels.php.
 */
export function getEcho(reverb: SharedProps['reverb']): Echo<'reverb'> | null {
    if (echo) return echo;
    if (!reverb.key) return null;
    (window as unknown as { Pusher: typeof Pusher }).Pusher = Pusher;
    echo = new Echo({
        broadcaster: 'reverb',
        key: reverb.key,
        wsHost: reverb.host ?? window.location.hostname,
        wsPort: reverb.port ?? 80,
        wssPort: reverb.port ?? 443,
        forceTLS: (reverb.scheme ?? 'https') === 'https',
        enabledTransports: ['ws', 'wss'],
        authorizer: (channel: { name: string }) => ({
            authorize: (socketId: string, done: (error: Error | null, data: { auth: string } | null) => void) => {
                api<{ auth: string }>('/broadcasting/auth', { body: { socket_id: socketId, channel_name: channel.name } })
                    .then((data) => done(null, data))
                    .catch((e) => done(e as Error, null));
            },
        }),
    } as never);
    return echo;
}
