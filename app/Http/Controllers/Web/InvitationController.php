<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Invitation;
use App\Support\CurrentInstitution;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** An invited person (e.g. a parent) opens their one-time link and chooses a password. */
class InvitationController extends Controller
{
    public function show(string $token): Response
    {
        $invite = $this->find($token);

        return Inertia::render('Auth/AcceptInvitation', [
            'token' => $token,
            'name' => $invite->user->name,
            'email' => $invite->user->email,
            'institution' => $invite->user->institution?->only(['id', 'name', 'short_code']),
        ]);
    }

    public function accept(Request $request, string $token): RedirectResponse
    {
        $invite = $this->find($token);
        $data = $request->validate(['password' => 'required|string|min:10|confirmed', 'accept' => 'accepted']);
        $user = $invite->user;
        $user->forceFill(['password' => $data['password'], 'policy_version' => config('sos.legal.policy_version'), 'policy_accepted_at' => now()])->save();
        CurrentInstitution::as($invite->institution_id, fn () => $invite->update(['accepted_at' => now()]));
        AuditLog::record('invitation.accepted', $user, [], $user->institution_id);

        return redirect()->route('login')->with('status', "Password set. Sign in with {$user->email} at {$user->institution?->name}.");
    }

    private function find(string $token): Invitation
    {
        $invite = CurrentInstitution::bypass(fn () => Invitation::with('user.institution')->where('token_hash', hash('sha256', $token))->first());
        abort_unless($invite && ! $invite->accepted_at && $invite->expires_at->isFuture() && $invite->user, 404, 'This link has expired or was already used.');

        return $invite;
    }
}
