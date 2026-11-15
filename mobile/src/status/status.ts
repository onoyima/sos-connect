import { api } from '@/lib/api';

export type Person = { id: number; name: string; title?: string | null };
export type Reactions = { like: number; love: number };
export type Status = {
    id: number; user: { id: number; name: string }; body: string | null; media_path: string | null; background?: string | null; audience: string | null;
    mentions?: Person[]; comment_count?: number; reactions?: Reactions; my_reaction?: 'like' | 'love' | null; view_count?: number | null;
    expires_at: string; created_at: string; viewed: boolean;
};
export type Comment = { id: number; user: Person; body: string; reply_to: { id: number; name: string | null; body: string } | null; created_at: string; can_delete: boolean };

/** Updates one status in the cache (after a like, a comment or a view). */
export function patchCached(id: number, patch: Partial<Status>) {
    cache = cache.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
export type StatusGroup = { userId: number; name: string; items: Status[]; unseen: boolean; latest: string };

let cache: Status[] = [];
export const setCache = (list: Status[]) => { cache = list; };
export const cachedStatuses = () => cache;

/** Status updates from people I can see, grouped per person, newest first (needs internet). */
export async function fetchStatuses(meId: number): Promise<{ mine: StatusGroup | null; others: StatusGroup[] }> {
    const r = await api<{ statuses: Status[] }>('/status');
    cache = r.statuses;
    return group(r.statuses, meId);
}

export function group(list: Status[], meId: number) {
    const by = new Map<number, StatusGroup>();
    for (const s of [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const g = by.get(s.user.id) ?? { userId: s.user.id, name: s.user.name, items: [], unseen: false, latest: s.created_at };
        g.items.push(s);
        g.unseen ||= !s.viewed && s.user.id !== meId;
        g.latest = s.created_at;
        by.set(s.user.id, g);
    }
    const all = [...by.values()].sort((a, b) => Number(b.unseen) - Number(a.unseen) || b.latest.localeCompare(a.latest));
    return { mine: by.get(meId) ?? null, others: all.filter((g) => g.userId !== meId) };
}

export const STATUS_COLORS = ['#1e7b57', '#0e3b2e', '#2f6f8f', '#6b4c8a', '#8a3b52', '#9a5b1f'];
