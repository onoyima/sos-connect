import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type { SharedProps } from '@/types';

let echo: Echo<'reverb'> | null = null;

/** Realtime over Laravel Reverb. Private channels are authorised by routes/channels.php. */
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
        authEndpoint: '/broadcasting/auth',
    });
    return echo;
}
