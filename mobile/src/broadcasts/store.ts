import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { emit, on } from '@/lib/events';

export type BroadcastItem = { id: number; kind: 'popup' | 'marquee'; style: 'info' | 'urgent' | 'celebration'; title: string | null; body: string; link_url: string | null; link_label: string | null; version: string };

let marquees: BroadcastItem[] = [];
let popups: BroadcastItem[] = [];
const hidden = new Set<string>();
export const keyOf = (b: BroadcastItem) => `${b.id}:${b.version}`;

/** Fetches what's running for me. Pop-ups are only offered when the app opens (see BroadcastPopup). */
export async function refreshBroadcasts(): Promise<BroadcastItem[]> {
    try {
        const r = await api<{ popups: BroadcastItem[]; marquees: BroadcastItem[] }>('/broadcasts/active');
        marquees = r.marquees;
        popups = r.popups;
        emit('broadcasts', undefined);
    } catch { /* offline: keep what we had */ }
    return popups;
}

export const currentPopups = () => popups;

export function hideMarquees() {
    marquees.forEach((m) => hidden.add(keyOf(m)));
    emit('broadcasts', undefined);
}

/** The marquee lines to show (not hidden this time the app is open). */
export function useMarquees(): BroadcastItem[] {
    const [list, setList] = useState(() => marquees.filter((m) => !hidden.has(keyOf(m))));
    useEffect(() => on('broadcasts', () => setList(marquees.filter((m) => !hidden.has(keyOf(m))))), []);
    return list;
}
