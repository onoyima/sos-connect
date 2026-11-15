import { Head, Link, router } from '@inertiajs/react';
import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Avatar, PageBody, PageHeader, memberLabel, when, Pager } from '@/components/ui';
import type { Paginated, UnitOption } from '@/types';

type Member = { id: number; name: string; identifier: string | null; title: string | null; member_type: string; department: string | null; level: number | null; alumni_year?: number | null; alumni_year_kind?: string | null; status: string; is_minor: boolean; guardian_consent: boolean; last_seen_at: string | null };
type Props = { members: Paginated<Member>; roles: { id: number; name: string }[]; units: UnitOption[]; filters: { q?: string; type?: string; role?: string; unit?: string } };

export default function Members({ members, roles, units, filters }: Props) {
    const [q, setQ] = useState(filters.q ?? '');
    const go = (patch: Record<string, string | undefined>) => router.get('/admin/members', { ...filters, q, ...patch }, { preserveState: true, replace: true });

    return (
        <AppLayout title="Members">
            <Head title="Members" />
            <PageHeader title="Members" description="People appear after their first sign-in. Open someone to change their roles and permissions. You only see the areas you look after." />
            <PageBody>
                <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); go({}); }}>
                    <div className="relative w-full sm:w-auto sm:min-w-60 sm:flex-1">
                        <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                        <input className="input pl-10" placeholder="Name, matric or staff number, or email" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    <select className="input min-w-0 flex-1 sm:w-auto sm:flex-none" value={filters.type ?? ''} onChange={(e) => go({ type: e.target.value || undefined })} aria-label="Kind of member">
                        <option value="">Everyone</option><option value="student">Students</option><option value="staff">Staff</option><option value="alumni">Alumni</option><option value="parent">Parents</option><option value="admin">Administrators</option>
                    </select>
                    <select className="input min-w-0 flex-1 sm:w-auto sm:max-w-56 sm:flex-none" value={filters.role ?? ''} onChange={(e) => go({ role: e.target.value || undefined })} aria-label="Role">
                        <option value="">Any role</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select className="input w-full sm:w-auto sm:max-w-64" value={filters.unit ?? ''} onChange={(e) => go({ unit: e.target.value || undefined })} aria-label="Area">
                        <option value="">Any area</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                </form>

                <div className="overflow-hidden rounded-2xl bg-white">
                    {members.data.length === 0 && <p className="px-4 py-10 text-center text-muted">Nobody matches that search.</p>}
                    {members.data.map((m) => (
                        <Link key={m.id} href={`/admin/members/${m.id}`} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-mist">
                            <Avatar name={m.name} size={40} />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold">{m.name}</span>
                                    {m.status === 'suspended' && <span className="pill bg-sos/10 text-sos">Suspended</span>}
                                    {m.is_minor && !m.guardian_consent && <span className="pill bg-amber/25 text-[#7a4d0b]">Under 18, needs consent</span>}
                                </div>
                                <div className="truncate text-sm text-muted">
                                    {[m.title ?? memberLabel(m.member_type), m.department, m.level ? `${m.level} level` : null, m.alumni_year ? (m.alumni_year_kind === 'entry' ? `${m.alumni_year} set` : `Class of ${m.alumni_year}`) : null, m.identifier].filter(Boolean).join(', ')}
                                </div>
                            </div>
                            <span className="hidden text-sm text-muted sm:block">{m.last_seen_at ? when(m.last_seen_at) : 'Never signed in'}</span>
                            <ChevronRight size={18} className="shrink-0 text-muted" />
                        </Link>
                    ))}
                </div>
                <Pager links={members.links} />
            </PageBody>
        </AppLayout>
    );
}

export { Pager };
