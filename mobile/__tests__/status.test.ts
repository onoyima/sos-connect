import { group, type Status } from '@/status/status';

const s = (id: number, userId: number, name: string, created: string, viewed = false): Status => ({
    id, user: { id: userId, name }, body: 'hi', media_path: null, audience: null, created_at: created, expires_at: created, viewed,
});

describe('status grouping', () => {
    it('groups by person, my own apart, unseen first', () => {
        const r = group([
            s(1, 5, 'Me', '2026-11-14T08:00:00Z'),
            s(2, 7, 'Ada', '2026-11-14T09:00:00Z', true),
            s(3, 8, 'Bayo', '2026-11-14T07:00:00Z'),
            s(4, 7, 'Ada', '2026-11-14T10:00:00Z', true),
        ], 5);
        expect(r.mine?.items.map((x) => x.id)).toEqual([1]);
        expect(r.others.map((x) => x.name)).toEqual(['Bayo', 'Ada']); // Bayo unseen, Ada all seen
        expect(r.others[1].items.map((x) => x.id)).toEqual([2, 4]);   // oldest first within a person
        expect(r.others[0].unseen).toBe(true);
    });
});
