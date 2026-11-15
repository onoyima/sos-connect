import { Head, Link } from '@inertiajs/react';
import { ChevronRight, Lock, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { PageBody, PageHeader } from '@/components/ui';

type RoleRow = { id: number; name: string; description: string | null; is_super: boolean; is_system: boolean; default_for: string | null; dm_protected: boolean; permission_count: number; holders: number | null };

export default function Roles({ roles, can }: { roles: RoleRow[]; can: { create: boolean; edit: boolean } }) {
    const automatic = roles.filter((r) => r.default_for);
    const given = roles.filter((r) => !r.default_for);

    return (
        <AppLayout title="Roles">
            <Head title="Roles" />
            <PageHeader
                title="Roles"
                description="A role is a set of permissions. Give roles to people from their member page, for the whole institution or one area. Change a role here and everyone with it changes too."
                actions={can.create && <Link href="/admin/roles/new" className="btn-primary"><Plus size={16} />New role</Link>}
            />
            <PageBody narrow>
                <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Given to people</h2>
                <div className="overflow-hidden rounded-2xl bg-white">
                    {given.map((r) => <Row key={r.id} r={r} />)}
                </div>
                <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-muted">Everyone gets one of these automatically</h2>
                <div className="overflow-hidden rounded-2xl bg-white">
                    {automatic.map((r) => <Row key={r.id} r={r} />)}
                </div>
                <p className="mt-3 px-1 text-sm text-muted">Edit these to change what every student, staff member or parent can do, for example to stop students posting status updates.</p>
            </PageBody>
        </AppLayout>
    );
}

function Row({ r }: { r: RoleRow }) {
    return (
        <Link href={`/admin/roles/${r.id}`} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-mist">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    {r.is_super && <span className="pill bg-grove text-white"><Lock size={11} />All permissions</span>}
                    {r.dm_protected && <span className="pill bg-mist text-muted">Students can't message privately</span>}
                </div>
                {r.description && <div className="truncate text-sm text-muted">{r.description}</div>}
            </div>
            <div className="hidden shrink-0 text-right text-sm text-muted sm:block">
                <div>{r.permission_count} permissions</div>
                {r.holders !== null && <div>{r.holders === 1 ? '1 person' : `${r.holders} people`}</div>}
            </div>
            <ChevronRight size={18} className="text-muted" />
        </Link>
    );
}
