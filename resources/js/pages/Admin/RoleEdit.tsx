import { Head, Link, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowLeft, Lock, MapPin, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Modal, PageBody } from '@/components/ui';
import type { CatalogGroup } from '@/types';

type Role = { id: number; name: string; description: string | null; is_super: boolean; is_system: boolean; default_for: string | null; dm_protected: boolean; permissions: string[] };
type Holder = { user_id: number; name: string; identifier: string | null; area: string | null; expires_at: string | null; source: string };
type Props = { role: Role | null; holders: Holder[]; catalog: CatalogGroup[]; grantable: string[]; can: { edit: boolean; delete: boolean } };

export default function RoleEdit({ role, holders, catalog, grantable, can }: Props) {
    const form = useForm({ name: role?.name ?? '', description: role?.description ?? '', dm_protected: role?.dm_protected ?? false, permissions: role?.permissions ?? [] as string[] });
    const [deleting, setDeleting] = useState(false);
    const locked = !can.edit;
    const selected = new Set(form.data.permissions);
    const allowed = new Set(grantable);
    const toggle = (key: string) => form.setData('permissions', selected.has(key) ? form.data.permissions.filter((p) => p !== key) : [...form.data.permissions, key]);
    const setGroup = (g: CatalogGroup, on: boolean) => {
        const keys = g.items.map((i) => i.key).filter((k) => allowed.has(k) || selected.has(k));
        form.setData('permissions', on ? [...new Set([...form.data.permissions, ...keys.filter((k) => allowed.has(k))])] : form.data.permissions.filter((p) => !keys.includes(p)));
    };
    const submit = () => (role ? form.put(`/admin/roles/${role.id}`, { preserveScroll: true }) : form.post('/admin/roles'));

    return (
        <AppLayout title={role?.name ?? 'New role'}>
            <Head title={role?.name ?? 'New role'} />
            <PageBody narrow>
                <Link href="/admin/roles" className="mt-5 mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf"><ArrowLeft size={16} />All roles</Link>
                <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
                    <section className="rounded-2xl bg-white p-5">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-bold">{role ? role.name : 'New role'}</h1>
                            {can.delete && <button type="button" className="btn-ghost text-sos" onClick={() => setDeleting(true)}><Trash2 size={16} />Delete</button>}
                        </div>
                        {role?.is_super && <p className="mt-2 flex items-center gap-2 rounded-xl bg-mint px-3 py-2 text-sm text-grove"><Lock size={15} />Super admin always has every permission, including new ones. Features that are switched off still apply.</p>}
                        {role?.default_for && <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-sm">Every {role.default_for} has this role automatically, everywhere in the institution.</p>}
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className="label" htmlFor="r-name">Name</label>
                                <input id="r-name" className="input" disabled={locked} value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} placeholder="Exams officer" />
                            </div>
                            <div>
                                <label className="label" htmlFor="r-desc">What it's for</label>
                                <input id="r-desc" className="input" disabled={locked} value={form.data.description} onChange={(e) => form.setData('description', e.target.value)} placeholder="Posts exam notices for their faculty" />
                            </div>
                        </div>
                        <label className="mt-3 flex items-start gap-3 text-[15px]">
                            <input type="checkbox" className="mt-1 size-4 accent-leaf" disabled={locked} checked={form.data.dm_protected} onChange={(e) => form.setData('dm_protected', e.target.checked)} />
                            <span>Students can't start private chats or calls with people in this role <span className="text-muted">(they use official groups or SOS instead)</span></span>
                        </label>
                        {Object.values(form.errors).map((e) => <p key={e} className="mt-2 text-sm text-sos">{e}</p>)}
                    </section>

                    <section className="rounded-2xl bg-white p-5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h2 className="text-lg font-bold">Permissions</h2>
                            <span className="text-sm text-muted">{role?.is_super ? 'All' : selected.size} selected</span>
                        </div>
                        <p className="mt-1 flex items-start gap-1.5 text-sm text-muted"><MapPin size={15} className="mt-0.5 shrink-0" />Permissions marked "area" follow where the role is given: an HOD given this role for Physics only gets them in Physics.</p>
                        <div className="mt-4 space-y-5">
                            {catalog.map((g) => {
                                const all = g.items.every((i) => selected.has(i.key) || role?.is_super);
                                return (
                                    <fieldset key={g.key}>
                                        <div className="flex items-center justify-between border-b border-line pb-1.5">
                                            <legend className="font-semibold text-grove">{g.label}</legend>
                                            {!locked && <button type="button" className="text-sm font-semibold text-leaf" onClick={() => setGroup(g, !all)}>{all ? 'Clear all' : 'Select all'}</button>}
                                        </div>
                                        <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                                            {g.items.map((i) => {
                                                const blocked = !allowed.has(i.key) && !selected.has(i.key);
                                                return (
                                                    <label key={i.key} className={`flex items-start gap-2.5 rounded-lg px-1 py-1 text-[15px] ${blocked ? 'opacity-50' : ''}`} title={blocked ? "You can only add permissions you have yourself" : undefined}>
                                                        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-leaf" disabled={locked || blocked}
                                                            checked={!!role?.is_super || selected.has(i.key)} onChange={() => toggle(i.key)} />
                                                        <span>{i.label}{i.area && <span className="ml-1.5 pill bg-mist px-1.5 py-0 text-[11px] text-muted">area</span>}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </fieldset>
                                );
                            })}
                        </div>
                    </section>

                    {!locked && (
                        <div className="sticky bottom-0 -mx-1 flex justify-end bg-mist/90 px-1 py-3 backdrop-blur">
                            <button className="btn-primary px-6 py-3" disabled={form.processing || !form.data.name.trim()}>{role ? 'Save role' : 'Create role'}</button>
                        </div>
                    )}
                </form>

                {role && !role.default_for && (
                    <section className="mt-4 rounded-2xl bg-white p-5">
                        <h2 className="text-lg font-bold">Who has this role</h2>
                        {holders.length === 0 ? <p className="mt-2 text-sm text-muted">Nobody yet. Give it from a person's member page.</p> : (
                            <ul className="mt-2 divide-y divide-line">
                                {holders.map((h, i) => (
                                    <li key={i}>
                                        <Link href={`/admin/members/${h.user_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-leaf">
                                            <span className="font-medium">{h.name}{h.identifier && <span className="text-muted">, {h.identifier}</span>}</span>
                                            <span className="text-sm text-muted">{h.area ?? 'Whole institution'}{h.expires_at ? `, until ${h.expires_at}` : ''}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </PageBody>

            {deleting && role && (
                <Modal title={`Delete "${role.name}"?`} onClose={() => setDeleting(false)}>
                    <p className="text-[15px]">Only roles that nobody has can be deleted.</p>
                    <div className="mt-4 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setDeleting(false)}>Keep it</button>
                        <button className="btn-danger" onClick={() => router.delete(`/admin/roles/${role.id}`)}>Delete role</button>
                    </div>
                </Modal>
            )}
        </AppLayout>
    );
}
