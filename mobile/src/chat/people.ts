import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** reach: chat now, send a request first, already requested, they asked me (accept), or can't be reached. */
export type Reach = 'direct' | 'request' | 'requested' | 'accept' | 'none';
export type Person = {
    id: number; name: string; title?: string | null; department?: string | null; member_type?: string; level?: number | null;
    reach?: Reach; request_id?: number | null; reach_note?: string | null;
};

/** Debounced people search (needs internet). type narrows to students or staff. */
export function usePeopleSearch(q: string, type: '' | 'student' | 'staff' = '') {
    const [people, setPeople] = useState<Person[]>([]);
    const [busy, setBusy] = useState(false);
    const [searched, setSearched] = useState(false);
    const run = useCallback(() => {
        if (q.trim().length < 2) { setPeople([]); setSearched(false); return; }
        setBusy(true);
        api<{ people: Person[] }>(`/directory?q=${encodeURIComponent(q.trim())}${type ? `&type=${type}` : ''}`)
            .then((r) => { setPeople(r.people); setSearched(true); }).catch(() => setPeople([])).finally(() => setBusy(false));
    }, [q, type]);
    useEffect(() => { const t = setTimeout(run, 300); return () => clearTimeout(t); }, [run]);
    const patch = (id: number, p: Partial<Person>) => setPeople((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
    return { people, busy, searched, patch, refresh: run };
}

export type ChatRequest = { id: number; message: string | null; created_at: string; person: Person };

export const fetchRequests = () => api<{ incoming: ChatRequest[]; outgoing: ChatRequest[] }>('/chat-requests');
