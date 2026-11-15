<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Services\Access\RoleManager;
use App\Support\Access;
use App\Support\PermissionCatalog;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Roles and the permissions inside them. */
class RolesController extends Controller
{
    public function __construct(private readonly RoleManager $roles) {}

    public function index(Request $request): Response
    {
        $me = $request->user();
        $counts = RoleAssignment::active()->selectRaw('role_id, count(distinct user_id) as n')->groupBy('role_id')->pluck('n', 'role_id');

        return Inertia::render('Admin/Roles', [
            'roles' => Role::with('permissions')->orderBy('rank')->orderBy('name')->get()->map(fn (Role $r) => [
                'id' => $r->id, 'name' => $r->name, 'description' => $r->description, 'is_super' => $r->is_super, 'is_system' => $r->is_system,
                'default_for' => $r->default_for, 'dm_protected' => $r->dm_protected,
                'permission_count' => $r->is_super ? count(PermissionCatalog::keys()) : $r->permissions->count(),
                'holders' => $r->default_for ? null : (int) ($counts[$r->id] ?? 0),
            ]),
            'can' => ['create' => Access::can($me, 'roles.create'), 'edit' => Access::can($me, 'roles.edit')],
        ]);
    }

    public function create(Request $request): Response
    {
        abort_unless(Access::can($request->user(), 'roles.create'), 403);

        return $this->editor($request, null);
    }

    public function edit(Request $request, Role $role): Response
    {
        return $this->editor($request, $role);
    }

    public function store(Request $request): RedirectResponse
    {
        $role = $this->roles->saveRole($request->user(), null, $this->validated($request));

        return redirect()->route('admin.roles.edit', $role)->with('status', "Role \"{$role->name}\" created. Give it to people from their member page.");
    }

    public function update(Request $request, Role $role): RedirectResponse
    {
        $this->roles->saveRole($request->user(), $role, $this->validated($request));

        return back()->with('status', "Saved \"{$role->name}\". Everyone with this role has the new permissions now.");
    }

    public function destroy(Request $request, Role $role): RedirectResponse
    {
        $name = $role->name;
        $this->roles->deleteRole($request->user(), $role);

        return redirect()->route('admin.roles')->with('status', "Deleted the role \"{$name}\".");
    }

    private function editor(Request $request, ?Role $role): Response
    {
        $me = $request->user();
        $holders = $role && ! $role->default_for ? RoleAssignment::with(['user:id,name,identifier', 'unit:id,name'])->where('role_id', $role->id)->active()
            ->limit(200)->get()->map(fn ($a) => ['user_id' => $a->user_id, 'name' => $a->user?->name, 'identifier' => $a->user?->identifier,
                'area' => $a->unit?->name, 'expires_at' => $a->expires_at?->toDateString(), 'source' => $a->source]) : [];

        return Inertia::render('Admin/RoleEdit', [
            'role' => $role ? [
                'id' => $role->id, 'name' => $role->name, 'description' => $role->description, 'is_super' => $role->is_super,
                'is_system' => $role->is_system, 'default_for' => $role->default_for, 'dm_protected' => $role->dm_protected,
                'permissions' => $role->is_super ? PermissionCatalog::keys() : $role->permissionKeys(),
            ] : null,
            'holders' => $holders,
            'catalog' => PermissionCatalog::forClient(),
            // Permissions this admin may put into a role (they must hold them everywhere themselves).
            'grantable' => Access::isSuper($me) ? PermissionCatalog::keys()
                : array_values(array_filter(PermissionCatalog::keys(), fn ($p) => Access::canEverywhere($me, $p))),
            'can' => [
                'edit' => Access::can($me, $role ? 'roles.edit' : 'roles.create') && ! $role?->is_super,
                'delete' => $role && Access::can($me, 'roles.delete') && ! $role->is_system,
            ],
        ]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => 'required|string|max:80', 'description' => 'nullable|string|max:300', 'dm_protected' => 'boolean',
            'permissions' => 'array', 'permissions.*' => 'string|max:60',
        ]);
    }
}
