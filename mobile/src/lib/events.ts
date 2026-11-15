type Handler<T> = (payload: T) => void;

/** Tiny event bus so screens refresh when the mesh, sync engine or sockets change local data. */
export type AppEvents = {
    messages: { conversationId: number };
    conversations: void;
    sos: void;
    peers: void;
    safety: void;
    announcements: void;
    online: boolean;
    /** The server stopped accepting this sign-in. reason 'replaced' = the account signed in on another phone. */
    unauthorized: { reason?: string | null };
    /** The account signed in somewhere else (device 'phone' keeps token id `keep`; 'web' is about the browser). */
    sessionReplaced: { device: 'phone' | 'web'; keep: number | string | null };
    callSignal: { from: number; data: any; via: 'online' | 'lan' };
    /** Group calls (online only): ring, someone joined/left, or a setup message from one person in the call. */
    groupCall: { kind: 'ring' | 'joined' | 'left' | 'signal'; data: any };
    /** Someone tagged me in a status, or reacted/commented on mine. */
    statusActivity: { kind: string; title: string; status_id: number };
    /** A chat request arrived, was accepted, or was declined/cancelled. */
    chatRequest: { kind: 'received' | 'accepted' | 'declined' | 'updated'; data: any };
    /** Red counts from the server: missed calls and chat requests (unread chats are counted on the phone). */
    badges: { chats: number; calls: number; requests: number };
    /** Pop-ups or marquee lines from the institution changed. */
    broadcasts: void;
};

const handlers: { [K in keyof AppEvents]?: Set<Handler<AppEvents[K]>> } = {};

export function on<K extends keyof AppEvents>(event: K, fn: Handler<AppEvents[K]>): () => void {
    (handlers[event] ??= new Set() as never);
    (handlers[event] as Set<Handler<AppEvents[K]>>).add(fn);
    return () => (handlers[event] as Set<Handler<AppEvents[K]>>).delete(fn);
}

export function emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    (handlers[event] as Set<Handler<AppEvents[K]>> | undefined)?.forEach((fn) => {
        try { fn(payload); } catch (e) { console.warn('[events]', event, e); }
    });
}
