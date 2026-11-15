<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\GuardianLink;
use App\Models\Invitation;
use App\Models\User;
use App\Services\Groups\AutoGroupSync;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Parents and guardians. Staff with "parents.invite" add a parent, link them to their child, and get a
 * one-time link the parent opens to choose a password. Parents see the university's announcements and the
 * parents group; they can't browse students or start private chats.
 */
class ParentsController extends Controller
{
    public function index(Request $request): Response
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'parents'), 404);
        $parents = User::inInstitution($me->institution_id)->where('member_type', 'parent')->orderBy('name')->limit(300)->get();
        $links = GuardianLink::with('student:id,name,identifier,department_unit_id')->whereIn('parent_id', $parents->pluck('id'))->get()->groupBy('parent_id');

        return Inertia::render('Admin/Parents', [
            'parents' => $parents->map(fn (User $p) => [
                'id' => $p->id, 'name' => $p->name, 'email' => $p->email, 'phone' => $p->phone, 'status' => $p->status,
                'has_password' => (bool) $p->password,
                'children' => ($links[$p->id] ?? collect())->map(fn ($l) => ['name' => $l->student?->name, 'identifier' => $l->student?->identifier, 'relationship' => $l->relationship])->values(),
            ]),
        ]);
    }

    /** A sign-up link for a parent who doesn't have a password yet (e.g. brought in from the student's records). */
    public function link(Request $request, User $parent): RedirectResponse
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'parents'), 404);
        abort_unless($parent->institution_id === $me->institution_id && $parent->member_type === 'parent' && ! $parent->password, 404);
        $children = User::whereIn('id', GuardianLink::where('parent_id', $parent->id)->pluck('student_id'))->get();
        abort_unless($children->contains(fn (User $c) => Access::canOnUser($me, 'parents.invite', $c)), 403, 'Their children are outside the areas you look after.');

        [, $token] = Invitation::issue($parent, $me);
        AuditLog::record('parent.link_issued', $parent);

        return back()->with('status', "Sign-up link for {$parent->name} (works once, for 14 days): ".route('invitation.show', $token));
    }

    public function invite(Request $request, AutoGroupSync $groups): RedirectResponse
    {
        $me = $request->user();
        abort_unless(Modules::enabled($me->institution, 'parents'), 404);
        $data = $request->validate([
            'name' => 'required|string|max:120',
            'email' => ['required', 'email', 'max:190', Rule::unique('users', 'email')->where('institution_id', $me->institution_id)],
            'phone' => 'nullable|string|max:30',
            'student_identifier' => 'required|string|max:60',
            'relationship' => 'nullable|string|max:40',
        ]);
        $student = User::inInstitution($me->institution_id)->where('member_type', 'student')->where('status', 'active')
            ->where(fn ($q) => $q->where('identifier', $data['student_identifier'])->orWhere('email', $data['student_identifier']))->first();
        abort_unless($student, 422, 'No active student has that matric number. They need to have signed in to SOS Connect at least once.');
        abort_unless(Access::canOnUser($me, 'parents.invite', $student), 403, 'That student is outside the areas you look after.');

        [$parent, $token] = DB::transaction(function () use ($me, $data, $student) {
            $parent = User::create(['institution_id' => $me->institution_id, 'auth_source' => 'local', 'member_type' => 'parent',
                'name' => $data['name'], 'email' => mb_strtolower($data['email']), 'phone' => $data['phone'] ?? null, 'status' => 'active']);
            GuardianLink::create(['parent_id' => $parent->id, 'student_id' => $student->id, 'relationship' => $data['relationship'] ?? null]);
            [, $token] = Invitation::issue($parent, $me);

            return [$parent, $token];
        });
        $groups->sync($parent);
        AuditLog::record('parent.invited', $parent, ['student_id' => $student->id]);

        return back()->with('status', "Invitation ready for {$parent->name}. Send them this link (it works once, for 14 days): ".route('invitation.show', $token));
    }
}
