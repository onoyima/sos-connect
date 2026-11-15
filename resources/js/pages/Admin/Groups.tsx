import { Head, Link, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Megaphone, Search, UsersRound } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';

type G = { id: number; name: string; type: string; auto_type: string | null; parent_id: number | null; posting: string; enabled: boolean; visible: boolean; member_count: number };

const KIND: Record<string, string> = {
    announcements: 'Announcements', general: 'General', students: 'Students', staff: 'Staff', parents: 'Parents',
    level: 'Level', course: 'Course', unit_staff: 'Unit staff',
};

export default function Groups({ groups, filters }: { groups: G[]; filters: { q?: string }; everywhere: boolean }) {
    const [q, setQ] = useState(filters.q ?? '');
    const [open, setOpen] = useState<Set<number>>(() => new Set(groups.filter((g) => g.type === 'community' && !g.parent_id).map((g) => g.id)));
    const byParent = useMemo(() => {
        const m = new Map<number | null, G[]>();
        const ids = new Set(groups.map((g) => g.id));
        for (const g of groups) {
            const p = g.parent_id && ids.has(g.parent_id) ? g.parent_id : null;
            m.set(p, [...(m.get(p) ?? []), g]);
        }
        return m;
    }, [groups]);
    const toggle = (id: number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const renderLevel = (parent: number | null, depth: number): React.ReactNode =>
        (byParent.get(parent) ?? []).sort((a, b) => (a.type === 'community' ? 0 : 1) - (b.type === 'community' ? 0 : 1) || order(a) - order(b) || a.name.localeCompare(b.name)).map((g) => (
            <div key={g.id}>
                <div className="flex items-center gap-2 border-b border-line/60 py-2 pr-3" style={{ paddingLeft: 12 + depth * 22 }}>
                    {g.type === 'community'
                        ? <button className="icon-btn size-7" onClick={() => toggle(g.id)} aria-label={open.has(g.id) ? 'Collapse' : 'Expand'}>{open.has(g.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                        : <span className="w-7" />}
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${g.type === 'community' ? 'bg-mint text-leaf' : g.auto_type === 'announcements' ? 'bg-grove text-white' : 'bg-mist text-muted'}`}>
                        {g.type === 'community' ? <UsersRound size={16} /> : g.auto_type === 'announcements' ? <Megaphone size={15} /> : <span className="text-xs font-bold">#</span>}
                    </span>
                    <Link href={`/admin/groups/${g.id}`} className={`min-w-0 flex-1 truncate ${g.type === 'community' ? 'font-semibold' : ''} hover:text-leaf`}>{g.name}</Link>
                    {g.auto_type && g.type !== 'community' && <span className="hidden pill bg-mist text-muted sm:inline-flex">{KIND[g.auto_type] ?? g.auto_type}</span>}
                    {g.type === 'group' && <span className="hidden pill bg-mist text-muted sm:inline-flex">Made by members</span>}
                    {!g.visible && <span className="pill bg-amber/25 text-[#7a4d0b]" title={g.enabled ? 'Its feature is switched off' : 'Switched off by an admin'}><EyeOff size={11} />Off</span>}
                    <span className="w-16 shrink-0 text-right text-sm text-muted">{g.member_count}</span>
                </div>
                {g.type === 'community' && open.has(g.id) && renderLevel(g.id, depth + 1)}
            </div>
        ));

    return (
        <AppLayout title="Groups">
            <Head title="Groups" />
            <PageHeader title="Communities and groups" description="Made automatically from your faculties, departments, levels, courses and units. Open one to switch it off, choose who can post, or make someone a group admin." />
            <PageBody>
                <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); router.get('/admin/groups', { q: q || undefined }, { preserveState: true }); }}>
                    <div className="relative flex-1">
                        <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                        <input className="input pl-10" placeholder="Find a group, e.g. 100 Level Physics" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    <button className="btn-primary">Search</button>
                </form>
                <div className="overflow-hidden rounded-2xl bg-white">
                    <div className="flex justify-between border-b border-line px-4 py-2 text-sm text-muted"><span>Name</span><span>People</span></div>
                    {groups.length === 0 ? <p className="px-4 py-10 text-center text-muted">No groups yet. Add faculties and departments, then use "Create all groups now" on Faculties and units.</p>
                        : filters.q ? groups.map((g) => (
                            <Link key={g.id} href={`/admin/groups/${g.id}`} className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 hover:bg-mist">
                                <span>{g.name}</span><span className="text-sm text-muted">{g.member_count}</span>
                            </Link>
                        )) : renderLevel(null, 0)}
                </div>
            </PageBody>
        </AppLayout>
    );
}

const ORDER = ['announcements', 'general', 'students', 'staff', 'parents', 'level', 'course', 'unit_staff'];
const order = (g: G) => { const i = ORDER.indexOf(g.auto_type ?? ''); return i === -1 ? 99 : i; };
