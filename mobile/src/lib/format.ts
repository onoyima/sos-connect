/** "14:05" today, "Yesterday", weekday this week, else a short date. */
export function chatTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
    if (days <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function dayLabel(iso: string): string {
    const d = new Date(iso);
    const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function clock(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fileSize(bytes?: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(seconds?: number | null): string {
    const s = Math.max(0, Math.round(seconds ?? 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Preview line for a chat: "Ada: Photo" etc. */
export function preview(m: { type: string; body: string | null; sender_name?: string | null; deleted?: boolean | number } | null, mine: boolean, group: boolean): string {
    if (!m) return 'No messages yet';
    const who = group ? (mine ? 'You: ' : m.sender_name ? `${m.sender_name.split(' ')[0]}: ` : '') : mine ? 'You: ' : '';
    if (m.deleted) return `${who}Message deleted`;
    const what = m.type === 'sticker' ? `Sticker${m.body ? ` · ${m.body}` : ''}` : m.type === 'image' ? `Photo${m.body ? ` · ${m.body}` : ''}` : m.type === 'voice' ? 'Voice note' : m.type === 'file' ? `File · ${m.body ?? ''}` : m.body ?? '';
    return who + what;
}

function startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
