import { Head, router, useForm } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { BookOpen, Building2, Pencil, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Modal, PageBody, PageHeader } from '@/components/ui';

type Unit = { id: number; name: string; code: string | null; type: string; parent_id: number | null; people: number; can_manage: boolean };
type Course = { id: number; code: string; title: string; level: number | null; semester: number | null; org_unit_id: number | null };
type Props = { units: Unit[]; courses: Course[]; types: Record<string, string>; can: { manage: boolean; everywhere: boolean } };

export default function Structure({ units, courses, types, can }: Props) {
    const [editing, setEditing] = useState<Partial<Unit> | null>(null);
    const [course, setCourse] = useState<Partial<Course> | null>(null);
    const [tab, setTab] = useState<'academic' | 'admin' | 'courses'>('academic');
    const faculties = units.filter((u) => u.type === 'faculty');
    const childrenOf = (id: number) => units.filter((u) => u.parent_id === id);
    const loose = units.filter((u) => u.type === 'department' && !faculties.some((f) => f.id === u.parent_id));
    const other = units.filter((u) => !['faculty', 'department'].includes(u.type));
    const coursesByDept = useMemo(() => {
        const m = new Map<number | null, Course[]>();
        for (const c of courses) m.set(c.org_unit_id, [...(m.get(c.org_unit_id) ?? []), c]);
        return m;
    }, [courses]);
    const unitName = (id: number | null) => units.find((u) => u.id === id)?.name ?? 'General studies';

    const row = (u: Unit, indent = false) => (
        <li key={u.id} className={`flex items-center gap-3 py-2.5 ${indent ? 'pl-6' : ''}`}>
            <div className="min-w-0 flex-1">
                <span className={indent ? '' : 'font-semibold'}>{u.name}</span>
                {u.code && <span className="ml-2 text-sm text-muted">{u.code}</span>}
            </div>
            <span className="text-sm text-muted">{u.people ? `${u.people} people` : ''}</span>
            {can.manage && u.can_manage && <button className="icon-btn" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil size={16} /></button>}
        </li>
    );

    return (
        <AppLayout title="Faculties and units">
            <Head title="Faculties and units" />
            <PageHeader
                title="Faculties and units"
                description="Your institution's structure. It decides which communities and groups exist and who joins them. Press Sync from records to bring in new or renamed faculties, departments, units, hostels and courses (it also runs nightly if switched on). You can add areas by hand too."
                actions={can.manage && (<>
                    {can.everywhere && <button className="btn-outline" onClick={() => router.post('/admin/structure/sync', {}, { preserveScroll: true })}><RefreshCw size={16} />Sync from records</button>}
                    {can.everywhere && <button className="btn-outline" onClick={() => router.post('/admin/structure/build-groups', {}, { preserveScroll: true })}><Wand2 size={16} />Create all groups now</button>}
                    <button className="btn-primary" onClick={() => tab === 'courses' ? setCourse({ semester: 1 }) : setEditing({ type: tab === 'admin' ? 'admin_department' : 'faculty' })}><Plus size={16} />{tab === 'courses' ? 'Add course' : 'Add area'}</button>
                </>)}
            />
            <PageBody>
                <div className="mb-4 flex w-fit rounded-full bg-white p-1 text-sm font-semibold">
                    {([['academic', 'Faculties and departments'], ['admin', 'Admin units and other areas'], ['courses', 'Courses']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 ${tab === k ? 'bg-grove text-white' : 'text-muted'}`}>{l}</button>
                    ))}
                </div>

                {tab === 'academic' && (
                    <div className="grid gap-3 md:grid-cols-2">
                        {faculties.map((f) => (
                            <section key={f.id} className="rounded-2xl bg-white px-5 py-3">
                                <ul className="divide-y divide-line">{row(f)}{childrenOf(f.id).map((d) => row(d, true))}</ul>
                            </section>
                        ))}
                        {loose.length > 0 && <section className="rounded-2xl bg-white px-5 py-3"><h2 className="pt-2 text-sm font-semibold text-muted">Departments without a faculty</h2><ul className="divide-y divide-line">{loose.map((d) => row(d))}</ul></section>}
                        {faculties.length === 0 && <p className="text-muted">No faculties yet.</p>}
                    </div>
                )}

                {tab === 'admin' && (
                    <section className="rounded-2xl bg-white px-5 py-3">
                        <ul className="divide-y divide-line">
                            {other.map((u) => (
                                <li key={u.id} className="flex items-center gap-3 py-2.5">
                                    <Building2 size={18} className="text-muted" />
                                    <div className="min-w-0 flex-1"><span className="font-semibold">{u.name}</span>{u.code && <span className="ml-2 text-sm text-muted">{u.code}</span>}</div>
                                    <span className="pill bg-mist text-muted">{types[u.type]}</span>
                                    {can.manage && u.can_manage && <button className="icon-btn" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil size={16} /></button>}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {tab === 'courses' && (
                    <div className="space-y-3">
                        {[...coursesByDept.entries()].sort((a, b) => unitName(a[0]).localeCompare(unitName(b[0]))).map(([dept, list]) => (
                            <section key={dept ?? 0} className="rounded-2xl bg-white px-5 py-3">
                                <h2 className="pt-1 font-semibold text-grove">{unitName(dept)}</h2>
                                <ul className="divide-y divide-line">
                                    {list.map((c) => (
                                        <li key={c.id} className="flex items-center gap-3 py-2">
                                            <BookOpen size={16} className="text-muted" />
                                            <span className="w-20 shrink-0 font-semibold">{c.code}</span>
                                            <span className="min-w-0 flex-1 truncate">{c.title}</span>
                                            <span className="text-sm text-muted">{c.level ? `${c.level}L` : ''}{c.semester ? `, sem ${c.semester}` : ''}</span>
                                            {can.manage && <button className="icon-btn" aria-label={`Edit ${c.code}`} onClick={() => setCourse(c)}><Pencil size={16} /></button>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </PageBody>

            {editing && <UnitForm unit={editing} units={units} types={types} onClose={() => setEditing(null)} />}
            {course && <CourseForm course={course} departments={units.filter((u) => u.type === 'department' && u.can_manage)} onClose={() => setCourse(null)} />}
        </AppLayout>
    );
}

function UnitForm({ unit, units, types, onClose }: { unit: Partial<Unit>; units: Unit[]; types: Record<string, string>; onClose: () => void }) {
    const form = useForm({ name: unit.name ?? '', code: unit.code ?? '', type: unit.type ?? 'department', parent_id: unit.parent_id ? String(unit.parent_id) : '' });
    const parents = units.filter((u) => u.id !== unit.id && (form.data.type === 'department' ? u.type === 'faculty' : true));
    const submit = () => {
        form.transform((d) => ({ ...d, parent_id: d.parent_id || null, code: d.code || null }));
        unit.id ? form.put(`/admin/structure/units/${unit.id}`, { onSuccess: onClose, preserveScroll: true }) : form.post('/admin/structure/units', { onSuccess: onClose, preserveScroll: true });
    };
    return (
        <Modal title={unit.id ? `Edit ${unit.name}` : 'Add an area'} onClose={onClose}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <div>
                    <label className="label" htmlFor="u-type">Kind</label>
                    <select id="u-type" className="input" value={form.data.type} onChange={(e) => form.setData('type', e.target.value)}>
                        {Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <div><label className="label" htmlFor="u-name">Name</label><input id="u-name" className="input" value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} placeholder="Hostel B" /></div>
                    <div><label className="label" htmlFor="u-code">Code</label><input id="u-code" className="input" value={form.data.code} onChange={(e) => form.setData('code', e.target.value)} /></div>
                </div>
                <div>
                    <label className="label" htmlFor="u-parent">Inside</label>
                    <select id="u-parent" className="input" value={form.data.parent_id} onChange={(e) => form.setData('parent_id', e.target.value)}>
                        <option value="">Nothing (top level)</option>
                        {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <div className="flex justify-between gap-2 pt-1">
                    {unit.id ? <button type="button" className="btn-ghost text-sos" onClick={() => router.delete(`/admin/structure/units/${unit.id}`, { onSuccess: onClose, preserveScroll: true })}><Trash2 size={16} />Delete</button> : <span />}
                    <button className="btn-primary" disabled={!form.data.name.trim() || form.processing}>Save</button>
                </div>
            </form>
        </Modal>
    );
}

function CourseForm({ course, departments, onClose }: { course: Partial<Course>; departments: Unit[]; onClose: () => void }) {
    const form = useForm({ code: course.code ?? '', title: course.title ?? '', level: course.level ? String(course.level) : '100', semester: String(course.semester ?? 1), org_unit_id: String(course.org_unit_id ?? departments[0]?.id ?? '') });
    const submit = () => course.id ? form.put(`/admin/structure/courses/${course.id}`, { onSuccess: onClose, preserveScroll: true }) : form.post('/admin/structure/courses', { onSuccess: onClose, preserveScroll: true });
    return (
        <Modal title={course.id ? `Edit ${course.code}` : 'Add a course'} onClose={onClose}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                    <div><label className="label" htmlFor="c-code">Code</label><input id="c-code" className="input" value={form.data.code} onChange={(e) => form.setData('code', e.target.value)} placeholder="PHY 101" /></div>
                    <div><label className="label" htmlFor="c-title">Title</label><input id="c-title" className="input" value={form.data.title} onChange={(e) => form.setData('title', e.target.value)} placeholder="General Physics I" /></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-1"><label className="label" htmlFor="c-level">Level</label><input id="c-level" type="number" step={100} className="input" value={form.data.level} onChange={(e) => form.setData('level', e.target.value)} /></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor="c-sem">Semester</label>
                        <select id="c-sem" className="input" value={form.data.semester} onChange={(e) => form.setData('semester', e.target.value)}><option value="1">First</option><option value="2">Second</option></select></div>
                </div>
                <div>
                    <label className="label" htmlFor="c-dept">Department</label>
                    <select id="c-dept" className="input" value={form.data.org_unit_id} onChange={(e) => form.setData('org_unit_id', e.target.value)}>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>
                {Object.values(form.errors).map((e) => <p key={e} className="text-sm text-sos">{e}</p>)}
                <div className="flex justify-between gap-2 pt-1">
                    {course.id ? <button type="button" className="btn-ghost text-sos" onClick={() => router.delete(`/admin/structure/courses/${course.id}`, { onSuccess: onClose, preserveScroll: true })}><Trash2 size={16} />Delete</button> : <span />}
                    <button className="btn-primary" disabled={!form.data.code.trim() || !form.data.title.trim() || form.processing}>Save course</button>
                </div>
            </form>
        </Modal>
    );
}
