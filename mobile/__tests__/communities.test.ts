import { buildTree, type Community } from '@/chat/communities';

const c = (id: number, name: string, parent_id: number | null): Community => ({ id, name, parent_id, description: null, member_count: 10 });
const g = (name: string, community_id: number, auto_type: string | null) => ({ name, community_id, auto_type });

describe('communities', () => {
    const tree = buildTree(
        [c(1, 'University', null), c(2, 'Faculty of Science', 1), c(3, 'Physics', 2), c(9, 'Hostels', 7)],
        [g('PHY 101', 3, 'course'), g('Physics Announcements', 3, 'announcements'), g('200 Level Physics', 3, 'level'), g('Physics General', 3, 'general'), g('Physics Students', 3, 'students')],
    );

    it('treats communities whose parent I am not in as top level', () => {
        expect(tree.top.map((x) => x.name)).toEqual(['University', 'Hostels']);
        expect(tree.children(1).map((x) => x.name)).toEqual(['Faculty of Science']);
    });

    it('orders groups: notices, general, students, levels, then courses', () => {
        expect(tree.groups(3).map((x) => x.name)).toEqual(['Physics Announcements', 'Physics General', 'Physics Students', '200 Level Physics', 'PHY 101']);
        expect(tree.groups(1)).toEqual([]);
    });
});
