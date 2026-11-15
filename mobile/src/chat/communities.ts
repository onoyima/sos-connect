import { db } from '@/db/database';
import type { ChatRow } from './ChatListItem';

export type Community = { id: number; name: string; description: string | null; parent_id: number | null; member_count: number };
type GroupLike = Pick<ChatRow, 'community_id' | 'auto_type' | 'name'>;

const ORDER = ['announcements', 'general', 'students', 'staff', 'parents', 'unit_staff', 'level', 'hostel', 'course', 'alumni', 'alumni_year', 'alumni_department'];
const rank = (t: string | null) => (ORDER.indexOf(t ?? '') + 1) || 99;

/**
 * Communities I'm in, arranged as a tree. Ones whose parent I'm not in count as top level. Groups inside a
 * community come in a fixed order: notices first, then general, students or staff, levels, hostels, courses.
 */
export function buildTree<G extends GroupLike>(all: Community[], chats: G[]) {
    const ids = new Set(all.map((c) => c.id));
    return {
        all,
        top: all.filter((c) => !c.parent_id || !ids.has(c.parent_id)),
        children: (id: number) => all.filter((c) => c.parent_id === id),
        groups: (id: number) => chats.filter((g) => g.community_id === id).sort((a, b) => rank(a.auto_type) - rank(b.auto_type) || a.name.localeCompare(b.name)),
        /** Unread messages in a community's groups and in every community inside it (muted groups don't count). */
        unreadIn: function unreadIn(id: number): number {
            const own = chats.filter((g) => g.community_id === id).reduce((n, g: any) => n + (g.muted ? 0 : Number(g.unread ?? 0)), 0);
            return own + all.filter((c) => c.parent_id === id).reduce((n, c) => n + unreadIn(c.id), 0);
        },
    };
}

export async function loadCommunities() {
    const d = await db();
    const all = await d.getAllAsync<Community>('SELECT * FROM communities ORDER BY name');
    const chats = await d.getAllAsync<ChatRow>('SELECT * FROM conversations WHERE community_id IS NOT NULL ORDER BY name');
    return buildTree(all, chats);
}
