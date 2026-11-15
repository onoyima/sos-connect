import { Head, Link, router, useForm } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { ArrowLeft, Ban, Check, KeyRound, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Avatar, Modal, PageBody, memberLabel, when } from '@/components/ui';
import type { CatalogGroup, UnitOption } from '@/types';

type Member = {
    id: number; name: string; identifier: string | null; title: string | null; email: string | null; phone: string | null; member_type: string;
    status: string; level: number | null; faculty: string | null; department: string | null; admin_unit: string | null; programme: string | null; residence: string | null; is_minor: boolean;
    guardian_consent: boolean; last_seen_at: string | null; auth_source: string; is_super: boolean;
};
type Assignment = { id: number; role: string; role_id: number; is_super: boolean; area: string | null; area_id: number | null; expires_at: string | null; expired: boolean; source: string; granted_by: string | null; note: string | null; can_remove: boolean };
type Direct = { id: number; permission: string; label: string; effect: 'grant' | 'deny'; area: string | null; expires_at: string | null; expired: boolean; granted_by: string | null; note: string | null; can_remove: boolean };
type Props = {
    member: Member; defaultRole: { id: number; name: string } | null; assignments: Assignment[]; direct: Direct[];
    effective: { key: string; label: string; group: string; where: string }[];
    roles: { id: number; name: string; description: string | null; is_super: boolean; permission_count: number }[];
    catalog: CatalogGroup[]; units: UnitOption[];
    can: { assign_roles: boolean; assign_everywhere: boolean; assign_permissions: boolean; suspend: boolean; consent: boolean };
};

export default function MemberShow({ member, defaultRole, assignments, direct, effective, roles, catalog, units, can }: Props) {
    const [adding, setAdding] = useState<null | 'role' | 'permission'>(null);
    const [suspending, setSuspending] = useState(false);
    const grouped = useMemo(() => {
        const m = new Map<string, typeof effective>();
        for (const e of effective) m.set(e.group, [...(m.get(e.group) ?? []), e]);
        return [...m.entries()];
    }, [effective]);
    const place = [member.department, member.faculty, member.admin_unit].filter(Boolean).join(', ');

    return (
        <AppLayout title={member.name}>
            <Head title={member.name} />
            <PageBody>
                <Link href="/admin/members" className="mt-5 mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf"><ArrowLeft size={16} />All members</Link>

                <section className="flex flex-wrap items-start gap-4 rounded-2xl bg-white p-5">
                    <Avatar name={member.name} size={64} />
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-bold">{member.name}</h1>
                        <p className="text-[15px] font-medium">{member.title ?? memberLabel(member.member_type)}</p>
                        <p className="text-[15px] text-muted">{[place, member.level ? `${member.level} level` : null].filter(Boolean).join(', ')}</p>
                        {(member.programme || member.residence) && <p className="text-[14px] text-muted">{[member.programme, member.residence ? `Hostel: ${member.residence}` : null].filter(Boolean).join(' · ')}</p>}
                        <p className="mt-1 text-sm text-muted">
                            {[member.identifier, member.email, member.phone].filter(Boolean).join(' · ') || 'No contact details shown'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <span className={`pill ${member.status === 'active' ? 'bg-mint text-grove' : 'bg-sos/10 text-sos'}`}>{member.status === 'active' ? 'Active' : 'Suspended'}</span>
                            {member.is_super && <span className="pill bg-grove text-white">Super admin</span>}
                            {member.is_minor && <span className={`pill ${member.guardian_consent ? 'bg-mint text-grove' : 'bg-amber/25 text-[#7a4d0b]'}`}>Under 18{member.guardian_consent ? ', consent on file' : ', needs guardian consent'}</span>}
                            <span className="pill bg-mist text-muted">{member.last_seen_at ? `Last seen ${when(member.last_seen_at)}` : 'Never signed in'}</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {can.consent && <button className="btn-outline" onClick={() => router.post(`/admin/members/${member.id}/consent`, { source: 'admission_records' }, { preserveScroll: true })}><Check size={16} />Record guardian consent</button>}
                        {can.suspend && (member.status === 'suspended'
                            ? <button className="btn-outline" onClick={() => router.post(`/admin/members/${member.id}/status`, { status: 'active' }, { preserveScroll: true })}>Restore access</button>
                            : <button className="btn-outline text-sos" onClick={() => setSuspending(true)}><Ban size={16} />Suspend</button>)}
                    </div>
                </section>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                    <div className="space-y-4">
                        <section className="rounded-2xl bg-white p-5">
                            <div className="flex items-center justify-between gap-2">
                                <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} className="text-leaf" />Roles</h2>
                                {can.assign_roles && <button className="btn-primary" onClick={() => setAdding('role')}><Plus size={16} />Give a role</button>}
                            </div>
                            <ul className="mt-3 divide-y divide-line">
                                {defaultRole && (
                                    <li className="py-3">
                                        <div className="font-semibold">{defaultRole.name}</div>
                                        <div className="text-sm text-muted">Everywhere. Every {memberLabel(member.member_type).toLowerCase() || 'member'} has this automatically.</div>
                                    </li>
                                )}
                                {assignments.map((a) => (
                                    <li key={a.id} className={`flex items-start gap-3 py-3 ${a.expired ? 'opacity-50' : ''}`}>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold">{a.role}</div>
                                            <div className="text-sm text-muted">
                                                {a.area ? `Only in ${a.area}` : 'Whole institution'}
                                                {a.expires_at ? `, ${a.expired ? 'ended' : 'until'} ${new Date(a.expires_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                                                {a.granted_by ? `, given by ${a.granted_by}` : ''}
                                            </div>
                                            {a.note && <div className="mt-0.5 text-sm text-muted italic">{a.note}</div>}
                                        </div>
                                        {a.can_remove && <button className="icon-btn hover:text-sos" title="Remove this role" aria-label={`Remove ${a.role}`}
                                            onClick={() => router.delete(`/admin/members/${member.id}/roles/${a.id}`, { preserveScroll: true })}><Trash2 size={17} /></button>}
                                    </li>
                                ))}
                                {!defaultRole && assignments.length === 0 && <li className="py-3 text-sm text-muted">No roles yet.</li>}
                            </ul>
                        </section>

                        <section className="rounded-2xl bg-white p-5">
                            <div className="flex items-center justify-between gap-2">
                                <h2 className="flex items-center gap-2 text-lg font-bold"><KeyRound size={20} className="text-leaf" />Single permissions</h2>
                                {can.assign_permissions && <button className="btn-outline" onClick={() => setAdding('permission')}><Plus size={16} />Add or take away</button>}
                            </div>
                            <p className="mt-1 text-sm text-muted">Extra permissions given to this person without a role, or permissions taken away from them even though a role includes them.</p>
                            <ul className="mt-3 divide-y divide-line">
                                {direct.map((p) => (
                                    <li key={p.id} className={`flex items-start gap-3 py-3 ${p.expired ? 'opacity-50' : ''}`}>
                                        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${p.effect === 'grant' ? 'bg-mint text-leaf' : 'bg-sos/10 text-sos'}`}>
                                            {p.effect === 'grant' ? <Plus size={14} /> : <X size={14} />}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold">{p.effect === 'grant' ? 'Can' : 'Cannot'}: {p.label.charAt(0).toLowerCase() + p.label.slice(1)}</div>
                                            <div className="text-sm text-muted">{p.area ? `Only in ${p.area}` : 'Whole institution'}{p.expires_at ? `, until ${new Date(p.expires_at).toLocaleDateString()}` : ''}{p.granted_by ? `, by ${p.granted_by}` : ''}</div>
                                            {p.note && <div className="mt-0.5 text-sm text-muted italic">{p.note}</div>}
                                        </div>
                                        {p.can_remove && <button className="icon-btn hover:text-sos" aria-label="Remove" onClick={() => router.delete(`/admin/members/${member.id}/permissions/${p.id}`, { preserveScroll: true })}><Trash2 size={17} /></button>}
                                    </li>
                                ))}
                                {direct.length === 0 && <li className="py-3 text-sm text-muted">None. Everything comes from their roles.</li>}
                            </ul>
                        </section>
                    </div>

                    <section className="h-fit rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">What they can do</h2>
                        <p className="mt-1 text-sm text-muted">Everything from their roles and single permissions together, with features that are switched off left out.</p>
                        {member.is_super && <p className="mt-3 rounded-xl bg-mint px-3 py-2 text-sm text-grove">Super admin: every permission, everywhere.</p>}
                        <div className="mt-3 space-y-4">
                            {grouped.map(([group, list]) => (
                                <div key={group}>
                                    <div className="text-sm font-semibold text-grove">{group}</div>
                                    <ul className="mt-1 space-y-1 text-sm">
                                        {list.map((e) => (
                                            <li key={e.key} className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-leaf" />
                                                <span>{e.label}{e.where !== 'Everywhere' && <span className="text-muted">: {e.where}</span>}</span></li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                            {effective.length === 0 && <p className="text-sm text-muted">Nothing at the moment.</p>}
                        </div>
                    </section>
                </div>
            </PageBody>

            {adding === 'role' && <GiveRole memberId={member.id} roles={roles} units={units} everywhere={can.assign_everywhere} onClose={() => setAdding(null)} />}
            {adding === 'permission' && <GivePermission memberId={member.id} catalog={catalog} units={units} everywhere={can.assign_everywhere} onClose={() => setAdding(null)} />}
            {suspending && <Suspend memberId={member.id} name={member.name} onClose={() => setSuspending(false)} />}
        </AppLayout>
    );
}

export function AreaSelect({ id, units, value, onChange, everywhere }: { id: string; units: UnitOption[]; value: string; onChange: (v: string) => void; everywhere: boolean }) {
    const byType = new Map<string, UnitOption[]>();
    for (const u of units) byType.set(u.type_label, [...(byType.get(u.type_label) ?? []), u]);
    return (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            {everywhere && <option value="">Whole institution</option>}
            {!everywhere && <option value="" disabled>Choose an area</option>}
            {[...byType.entries()].map(([t, list]) => (
                <optgroup key={t} label={t}>{list.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
            ))}
        </select>
    );
}

function GiveRole({ memberId, roles, units, everywhere, onClose }: { memberId: number; roles: Props['roles']; units: UnitOption[]; everywhere: boolean; onClose: () => void }) {
    const form = useForm({ role_id: roles[0]?.id ?? 0, unit_id: '' as string, expires_at: '', note: '' });
    const role = roles.find((r) => r.id === Number(form.data.role_id));
    return (
        <Modal title="Give a role" onClose={onClose} wide>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); form.transform((d) => ({ ...d, unit_id: d.unit_id || null, expires_at: d.expires_at || null })); form.post(`/admin/members/${memberId}/roles`, { preserveScroll: true, onSuccess: onClose }); }}>
                <div>
                    <label className="label" htmlFor="gr-role">Role</label>
                    <select id="gr-role" className="input" value={form.data.role_id} onChange={(e) => form.setData('role_id', Number(e.target.value))}>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    {role?.description && <p className="mt-1 text-sm text-muted">{role.description} ({role.permission_count} permissions)</p>}
                </div>
                {!role?.is_super && (
                    <div>
                        <label className="label" htmlFor="gr-area">Where it applies</label>
                        <AreaSelect id="gr-area" units={units} value={form.data.unit_id} onChange={(v) => form.setData('unit_id', v)} everywhere={everywhere} />
                        <p className="mt-1 text-sm text-muted">A faculty covers all its departments. For a head of department, pick their department.</p>
                    </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="label" htmlFor="gr-until">Until <span className="font-normal text-muted">(optional, for acting roles)</span></label>
                        <input id="gr-until" type="date" className="input" value={form.data.expires_at} onChange={(e) => form.setData('expires_at', e.target.value)} />
                    </div>
                    <div>
                        <label className="label" htmlFor="gr-note">Note <span className="font-normal text-muted">(optional)</span></label>
                        <input id="gr-note" className="input" placeholder="Acting HOD while Dr Eze is on leave" value={form.data.note} onChange={(e) => form.setData('note', e.target.value)} />
                    </div>
                </div>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <p className="text-sm text-muted">You can only give a role whose permissions you have yourself, in an area you look after.</p>
                <button className="btn-primary w-full py-3" disabled={form.processing || (!everywhere && !form.data.unit_id && !role?.is_super)}>Give role</button>
            </form>
        </Modal>
    );
}

function GivePermission({ memberId, catalog, units, everywhere, onClose }: { memberId: number; catalog: CatalogGroup[]; units: UnitOption[]; everywhere: boolean; onClose: () => void }) {
    const first = catalog[0]?.items[0]?.key ?? '';
    const form = useForm({ permission: first, effect: 'grant' as 'grant' | 'deny', unit_id: '' as string, expires_at: '', note: '' });
    const item = catalog.flatMap((g) => g.items).find((i) => i.key === form.data.permission);
    return (
        <Modal title="Add or take away a permission" onClose={onClose} wide>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); form.transform((d) => ({ ...d, unit_id: d.unit_id || null, expires_at: d.expires_at || null })); form.post(`/admin/members/${memberId}/permissions`, { preserveScroll: true, onSuccess: onClose }); }}>
                <div className="flex rounded-full bg-mist p-1 text-sm font-semibold">
                    {(['grant', 'deny'] as const).map((v) => (
                        <button type="button" key={v} onClick={() => form.setData('effect', v)} className={`flex-1 rounded-full py-1.5 ${form.data.effect === v ? 'bg-white text-grove' : 'text-muted'}`}>
                            {v === 'grant' ? 'Give this permission' : 'Take it away'}
                        </button>
                    ))}
                </div>
                <div>
                    <label className="label" htmlFor="gp-perm">Permission</label>
                    <select id="gp-perm" className="input" value={form.data.permission} onChange={(e) => form.setData('permission', e.target.value)}>
                        {catalog.map((g) => <optgroup key={g.key} label={g.label}>{g.items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}</optgroup>)}
                    </select>
                    {form.data.effect === 'deny' && <p className="mt-1 text-sm text-muted">Taking a permission away beats any role they have.</p>}
                </div>
                {item?.area ? (
                    <div>
                        <label className="label" htmlFor="gp-area">Where it applies</label>
                        <AreaSelect id="gp-area" units={units} value={form.data.unit_id} onChange={(v) => form.setData('unit_id', v)} everywhere={everywhere} />
                    </div>
                ) : <p className="text-sm text-muted">This permission is about the whole institution, so it can't be limited to one area.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="label" htmlFor="gp-until">Until <span className="font-normal text-muted">(optional)</span></label>
                        <input id="gp-until" type="date" className="input" value={form.data.expires_at} onChange={(e) => form.setData('expires_at', e.target.value)} />
                    </div>
                    <div>
                        <label className="label" htmlFor="gp-note">Note <span className="font-normal text-muted">(optional)</span></label>
                        <input id="gp-note" className="input" value={form.data.note} onChange={(e) => form.setData('note', e.target.value)} />
                    </div>
                </div>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <button className={`${form.data.effect === 'deny' ? 'btn-danger' : 'btn-primary'} w-full py-3`} disabled={form.processing}>
                    {form.data.effect === 'deny' ? 'Take it away' : 'Give permission'}
                </button>
            </form>
        </Modal>
    );
}

function Suspend({ memberId, name, onClose }: { memberId: number; name: string; onClose: () => void }) {
    const [reason, setReason] = useState('');
    return (
        <Modal title={`Suspend ${name}?`} onClose={onClose}>
            <p className="text-[15px]">They'll be signed out everywhere and can't use SOS Connect until you restore them. SOS from their phone still reaches nearby phones.</p>
            <label className="label mt-4" htmlFor="sus-reason">Reason, kept in the audit log</label>
            <textarea id="sus-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-danger" disabled={!reason.trim()} onClick={() => router.post(`/admin/members/${memberId}/status`, { status: 'suspended', reason }, { preserveScroll: true, onSuccess: onClose })}>Suspend</button>
            </div>
        </Modal>
    );
}
