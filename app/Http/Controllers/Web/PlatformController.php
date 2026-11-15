<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Institution;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Our own team: verify and activate institutions. Platform admins never see members' messages. */
class PlatformController extends Controller
{
    public function institutions(): Response
    {
        return Inertia::render('Platform/Institutions', [
            'institutions' => Institution::with('connector:id,institution_id,last_test_ok,last_tested_at')
                ->withCount('users')->latest()->get()
                ->map(fn ($i) => $i->only(['id', 'name', 'short_code', 'country', 'status', 'contact_name', 'contact_email', 'dpo_email',
                    'dpa_version', 'dpa_accepted_by', 'verified_at', 'users_count']) + ['connector_ok' => (bool) $i->connector?->last_test_ok]),
        ]);
    }

    public function setStatus(Request $request, Institution $institution): RedirectResponse
    {
        $data = $request->validate(['status' => 'required|in:active,suspended,pending', 'note' => 'nullable|string|max:300', 'force' => 'boolean']);
        // Normally switched on once its records connection works. The operator can still switch it on first (e.g. so its
        // admin can finish setting up); students and staff just can't sign in until the connection works.
        $connected = (bool) $institution->connector?->last_test_ok;
        if ($data['status'] === 'active' && ! $connected && ! ($data['force'] ?? false)) {
            return back()->with('status', "{$institution->name}'s records connection isn't working yet. Tick \"Switch on anyway\" to go ahead.");
        }
        $institution->update(['status' => $data['status'], 'verified_at' => $data['status'] === 'active' ? ($institution->verified_at ?? now()) : $institution->verified_at]);
        AuditLog::record('institution.'.$data['status'], $institution, ['note' => $data['note'] ?? null, 'records_connected' => $connected], $institution->id);

        return back()->with('status', "{$institution->name} is now {$data['status']}."
            .($data['status'] === 'active' && ! $connected ? ' Students and staff can sign in once its records connection works (Admin > Settings > Your records).' : ''));
    }
}
