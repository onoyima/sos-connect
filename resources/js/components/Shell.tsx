import { usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import type { SharedProps } from '@/types';
import { CallManager } from './CallManager';
import { MessageNotifier } from './MessageNotifier';
import { PlatformChat } from './PlatformChat';
import { SosAlarm } from './SosAlarm';

/**
 * Stays on screen while people move between pages (like WhatsApp): a call carries on, the SOS alarm keeps ringing,
 * and message sounds keep working, instead of everything starting again on each page.
 */
export function Shell({ children }: { children: ReactNode }) {
    const { auth } = usePage<SharedProps>().props;
    const url = usePage().url;
    return (
        <>
            {children}
            {auth && <CallManager />}
            {auth && auth.permissions.includes('chat.use') && <MessageNotifier meId={auth.user.id} />}
            {auth?.permissions.includes('sos.view') && <SosAlarm />}
            {auth?.platform_chat && <PlatformChat lifted={url.startsWith('/chats')} />}
        </>
    );
}

/** The same function every time, so React keeps the Shell (and what's inside it) between pages. */
export const shellLayout = (page: ReactNode) => <Shell>{page}</Shell>;
