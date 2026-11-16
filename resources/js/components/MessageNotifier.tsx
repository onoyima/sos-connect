import { router } from '@inertiajs/react';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { listenInstitution, listenUser, onChange, onMessage } from '@/lib/live';
import { openChat } from '@/lib/openChat';
import { playFor } from '@/lib/tones';
import type { ChatMessage, ConversationSummary } from '@/types';

type Info = { name: string; type: string; quiet: boolean };

/**
 * Sounds and desktop notifications for new messages, chat requests and notices, with the tones each person chose
 * (Settings > Sounds). Muted, paused and archived chats stay quiet, and so does the chat that is open on screen.
 */
export function MessageNotifier({ meId }: { meId: number }) {
    const chats = useRef(new Map<number, Info>());
    const lastSound = useRef(0);

    useEffect(() => {
        const load = () => api<{ conversations: (ConversationSummary & { muted?: boolean; paused?: boolean; archived?: boolean })[] }>('/conversations')
            .then((r) => { chats.current = new Map(r.conversations.map((c) => [c.id, { name: c.name ?? 'Chat', type: c.type, quiet: !!(c.muted || c.paused || c.archived) }])); })
            .catch(() => {});
        load();
        const offs = [
            onChange('conversations', load),
            onMessage((kind, m: ChatMessage) => {
                if (kind !== 'message.created' || m.sender_id === meId || m.type === 'system') return;
                const c = chats.current.get(m.conversation_id);
                if (!c) { load(); return; }
                const here = openChat() === m.conversation_id && !document.hidden;
                const mentioned = (m.mentions ?? []).some((x: { id: number }) => x.id === meId);
                if ((c.quiet && !mentioned) || here) return;
                const now = Date.now();
                if (now - lastSound.current > 1500) { lastSound.current = now; playFor(c.type === 'direct' ? 'message' : 'group'); }
                if (document.hidden) {
                    const body = m.type === 'text' ? (m.body ?? '') : m.type === 'image' ? 'Photo' : m.type === 'voice' ? 'Voice note' : m.type === 'sticker' ? 'Sticker' : 'File';
                    notify(c.type === 'direct' ? (m.sender_name ?? c.name) : `${c.name} · ${m.sender_name ?? ''}`, body, `chat-${m.conversation_id}`,
                        () => router.visit(`/chats/${m.conversation_id}`));
                }
            }),
            listenUser('chat_request.received', (e: { from?: { name?: string } }) => {
                playFor('request');
                if (document.hidden) notify('New chat request', `${e?.from?.name ?? 'Someone'} would like to chat`, 'chat-request', () => router.visit('/chats'));
            }),
            listenInstitution('announcement.published', (e: { title?: string }) => {
                playFor('notice');
                if (document.hidden) notify('New notice', e?.title ?? 'Your institution posted a notice', 'notice', () => router.visit('/announcements'));
            }),
        ];
        return () => offs.forEach((f) => f());
    }, [meId]);

    return null;
}

function notify(title: string, body: string, tag: string, onClick: () => void) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, { body: body.slice(0, 140), tag });
        n.onclick = () => { window.focus(); onClick(); n.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
}
