import { Head, Link, router, useForm } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { ArrowLeft, Search, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Avatar, Modal, PageBody, memberLabel } from '@/components/ui';
import { api } from '@/lib/api';
import type { Paginated } from '@/types';
import { Pager } from './Members';

type Group = { id: number; name: string; description: string | null; type: string; auto_type: string | null; posting: string; enabled: boolean; visible: boolean; community: string | null; area: string | null; children: { id: number; name: string; type: string; enabled: boolean }[] };
type Row = { user_id: number; name: string; identifier: string | null; title: string | null; member_type: string; role: string; powers: string[]; managed: boolean };
type Props = { group: Group; members: Paginated<Row>; powerLabels: Record<string, string>; filters: { q?: string }; can: { manage: boolean; members: boolean; admins: boolean } };

export default function GroupShow({ group, members, powerLabels, filters, can }: Props) {
    const form = useForm({ name: group.name, description: group.description ?? '', posting: group.posting });
    const [q, setQ] = useState(filters.q ?? '');
    const [adminFor, setAdminFor] = useState<{ user_id: number; name: string; powers: string[]; role: string } | null>(null);
    const [adding, setAdding] = useState(false);
    const isCommunity = group.type === 'community';

    return (
        <AppLayout title={group.name}>
            <Head title={group.name} />
            <PageBody>
                <Link href="/admin/groups" className="mt-5 mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf"><ArrowLeft size={16} />All groups</Link>
                <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
                    <section className="h-fit rounded-2xl bg-white p-5">
                        <h1 className="text-2xl font-bold">{group.name}</h1>
                        <p className="mt-1 text-sm text-muted">{[isCommunity ? 'Community' : group.type === 'group' ? 'Made by members' : 'Automatic group', group.community && `in ${group.community}`, group.area && `area: ${group.area}`].filter(Boolean).join(', ')}</p>
                        {!group.visible && group.enabled && <p className="mt-3 rounded-xl bg-amber/15 px-3 py-2 text-sm">Hidden because its feature is switched off in Features.</p>}

                        {can.manage ? (
                            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); form.patch(`/admin/groups/${group.id}`, { preserveScroll: true }); }}>
                                <div>
                                    <label className="label" htmlFor="g-name">Name</label>
                                    <input id="g-name" className="input" value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} />
                                </div>
                                <div>
                                    <label className="label" htmlFor="g-desc">Description</label>
                                    <textarea id="g-desc" rows={2} className="input" value={form.data.description} onChange={(e) => form.setData('description', e.target.value)} />
                                </div>
                                {!isCommunity && (
                                    <div>
                                        <span className="label">Who can post</span>
                                        <div className="flex rounded-full bg-mist p-1 text-sm font-semibold">
                                            {(['everyone', 'admins'] as const).map((v) => (
                                                <button type="button" key={v} onClick={() => form.setData('posting', v)} className={`flex-1 rounded-full py-1.5 ${form.data.posting === v ? 'bg-white text-grove' : 'text-muted'}`}>
                                                    {v === 'everyone' ? 'Everyone in it' : 'Only admins'}
                                                </button>
                                            ))}
                                        </div>
                                        {group.auto_type === 'announcements' && <p className="mt-1 text-sm text-muted">People allowed to post notices for this area can always post here.</p>}
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <button className="btn-primary" disabled={form.processing}>Save</button>
                                    <button type="button" className={group.enabled ? 'btn-outline text-sos' : 'btn-outline'}
                                        onClick={() => router.patch(`/admin/groups/${group.id}`, { enabled: !group.enabled }, { preserveScroll: true })}>
                                        {group.enabled ? 'Switch off' : 'Switch on'}
                                    </button>
                                </div>
                            </form>
                        ) : <p className="mt-3 text-sm text-muted">You can see this group but not change it.</p>}

                        {group.children.length > 0 && (
                            <div className="mt-5 border-t border-line pt-4">
                                <h2 className="text-sm font-semibold text-muted">Inside</h2>
                                <ul className="mt-1">{group.children.map((c) => <li key={c.id}><Link className="block py-1 hover:text-leaf" href={`/admin/groups/${c.id}`}>{c.name}{!c.enabled && ' (off)'}</Link></li>)}</ul>
                            </div>
                        )}
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-lg font-bold">People <span className="font-normal text-muted">({members.total ?? members.data.length})</span></h2>
                            <div className="flex gap-2">
                                {can.admins && <button className="btn-outline" onClick={() => setAdding(true)}><ShieldCheck size={16} />Make someone admin</button>}
                                {can.members && !isCommunity && <button className="btn-outline" onClick={() => setAdding(true)}><UserPlus size={16} />Add</button>}
                            </div>
                        </div>
                        <form className="relative mt-3" onSubmit={(e) => { e.preventDefault(); router.get(`/admin/groups/${group.id}`, { q: q || undefined }, { preserveState: true }); }}>
                            <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
                            <input className="input pl-10" placeholder="Find someone in this group" value={q} onChange={(e) => setQ(e.target.value)} />
                        </form>
                        <ul className="mt-2 divide-y divide-line">
                            {members.data.map((m) => (
                                <li key={m.user_id} className="flex items-center gap-3 py-2.5">
                                    <Avatar name={m.name} size={36} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{m.name}</span>{m.role === 'admin' && <span className="pill bg-mint text-grove">Admin</span>}</div>
                                        <div className="truncate text-sm text-muted">
                                            {m.role === 'admin' ? (m.powers.length === Object.keys(powerLabels).length ? 'All group powers' : m.powers.map((p) => powerLabels[p]).join(', ') || 'No powers')
                                                : [m.title ?? memberLabel(m.member_type), m.identifier, m.managed ? 'added from records' : null].filter(Boolean).join(', ')}
                                        </div>
                                    </div>
                                    {can.admins && <button className="btn-ghost px-3 text-sm" onClick={() => setAdminFor(m)}>{m.role === 'admin' ? 'Change powers' : 'Make admin'}</button>}
                                    {can.members && <button className="icon-btn hover:text-sos" title="Remove from group" aria-label={`Remove ${m.name}`}
                                        onClick={() => router.delete(`/admin/groups/${group.id}/members/${m.user_id}`, { preserveScroll: true })}><UserMinus size={17} /></button>}
                                </li>
                            ))}
                        </ul>
                        <Pager links={members.links} />
                    </section>
                </div>
            </PageBody>

            {adminFor && <AdminPowers groupId={group.id} person={adminFor} labels={powerLabels} onClose={() => setAdminFor(null)} />}
            {adding && <AddPerson onPick={(p, admin) => {
                setAdding(false);
                if (admin) setAdminFor({ user_id: p.id, name: p.name, powers: Object.keys(powerLabels), role: 'member' });
                else router.post(`/admin/groups/${group.id}/members`, { user_id: p.id }, { preserveScroll: true });
            }} canAdd={can.members && !isCommunity} canAdmin={can.admins} onClose={() => setAdding(false)} />}
        </AppLayout>
    );
}

function AdminPowers({ groupId, person, labels, onClose }: { groupId: number; person: { user_id: number; name: string; powers: string[]; role: string }; labels: Record<string, string>; onClose: () => void }) {
    const [powers, setPowers] = useState<string[]>(person.role === 'admin' ? person.powers : Object.keys(labels));
    const save = (role: 'admin' | 'member') => router.post(`/admin/groups/${groupId}/members/${person.user_id}/role`, { role, powers }, { preserveScroll: true, onSuccess: onClose });
    return (
        <Modal title={`${person.name} as group admin`} onClose={onClose}>
            <p className="text-sm text-muted">Choose what they can do in this group. This only applies inside this group.</p>
            <div className="mt-3 space-y-2">
                {Object.entries(labels).map(([k, l]) => (
                    <label key={k} className="flex items-start gap-3 text-[15px]">
                        <input type="checkbox" className="mt-1 size-4 accent-leaf" checked={powers.includes(k)} onChange={() => setPowers((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
                        {l}
                    </label>
                ))}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
                {person.role === 'admin' && <button className="btn-ghost text-sos" onClick={() => save('member')}>Remove as admin</button>}
                <button className="btn-primary" disabled={powers.length === 0} onClick={() => save('admin')}>{person.role === 'admin' ? 'Save powers' : 'Make admin'}</button>
            </div>
        </Modal>
    );
}

type Person = { id: number; name: string; title?: string | null; member_type?: string; department?: string };

function AddPerson({ onPick, onClose, canAdd, canAdmin }: { onPick: (p: Person, admin: boolean) => void; onClose: () => void; canAdd: boolean; canAdmin: boolean }) {
    const [q, setQ] = useState('');
    const [people, setPeople] = useState<Person[]>([]);
    useEffect(() => {
        if (q.trim().length < 2) return setPeople([]);
        const t = setTimeout(() => api<{ people: Person[] }>(`/directory?q=${encodeURIComponent(q)}`).then((r) => setPeople(r.people)).catch(() => {}), 300);
        return () => clearTimeout(t);
    }, [q]);
    return (
        <Modal title="Find a person" onClose={onClose}>
            <input className="input" autoFocus placeholder="Name, matric or staff number" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="scroll-area mt-2 max-h-80">
                {people.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-mist">
                        <Avatar name={p.name} size={36} />
                        <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted">{[p.title ?? memberLabel(p.member_type), p.department].filter(Boolean).join(', ')}</div></div>
                        {canAdd && <button className="btn-ghost px-3 text-sm" onClick={() => onPick(p, false)}>Add</button>}
                        {canAdmin && <button className="btn-ghost px-3 text-sm" onClick={() => onPick(p, true)}>Make admin</button>}
                    </li>
                ))}
            </ul>
        </Modal>
    );
}
