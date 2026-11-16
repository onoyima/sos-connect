<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AccountDeletion;
use App\Models\AuditLog;
use App\Models\Message;
use App\Models\SosAlert;
use App\Services\Accounts\AccountClosure;
use App\Support\Access;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin > Deleted accounts: every account a member closed ("Delete my account"), kept for the institution to trace,
 * with who they were at the time, when and from where, and a way to restore it. Admins see the areas they look after.
 */
class DeletedAccountsController extends Controller
{
    private function query(Request $request): Builder
    {
        $me = $request->user();
        $q = AccountDeletion::query()->where('institution_id', $me->institution_id)
            ->with(['user:id,name,identifier,member_type,department_unit_id,faculty_unit_id,admin_unit_id,status', 'closer:id,name', 'restorer:id,name'])
            ->latest('requested_at');
        $units = Access::units($me, 'members.view');
        if ($units !== null) {
            $q->whereHas('user', fn ($u) => $u->where(fn ($w) => $w->whereIn('department_unit_id', $units ?: [0])
                ->orWhereIn('faculty_unit_id', $units ?: [0])->orWhereIn('admin_unit_id', $units ?: [0])));
        }
        if ($s = trim((string) $request->query('q'))) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $s).'%';
            $q->where(fn ($w) => $w->where('snapshot->name', 'like', $like)->orWhere('snapshot->identifier', 'like', $like)
                ->orWhere('snapshot->email', 'like', $like)->orWhere('snapshot->phone', 'like', $like)
                ->orWhereHas('user', fn ($u) => $u->where('name', 'like', $like)->orWhere('identifier', 'like', $like)));
        }
        if (in_array($request->query('status'), ['closed', 'restored'], true)) {
            $q->where('status', $request->query('status'));
        }
        if ($type = $request->query('type')) {
            $q->where('snapshot->member_type', $type);
        }

        return $q;
    }

    public function index(Request $request): Response
    {
        $me = $request->user();
        $page = $this->query($request)->paginate(30)->withQueryString();
        $ids = collect($page->items())->pluck('user_id')->filter()->all();
        $messages = $ids ? Message::withoutGlobalScopes()->whereIn('sender_id', $ids)->selectRaw('sender_id, COUNT(*) n')->groupBy('sender_id')->pluck('n', 'sender_id') : collect();
        $groups = $ids ? DB::table('conversation_members')->whereIn('user_id', $ids)->selectRaw('user_id, COUNT(*) n')->groupBy('user_id')->pluck('n', 'user_id') : collect();
        $sos = $ids ? SosAlert::withoutGlobalScopes()->whereIn('user_id', $ids)->selectRaw('user_id, COUNT(*) n')->groupBy('user_id')->pluck('n', 'user_id') : collect();
        $showContacts = Access::can($me, 'members.contact');

        return Inertia::render('Admin/DeletedAccounts', [
            'records' => $page->through(fn (AccountDeletion $d) => [
                'id' => $d->id, 'user_id' => $d->user_id, 'status' => $d->status, 'source' => $d->source, 'reason' => $d->reason,
                'requested_at' => $d->requested_at->toIso8601String(), 'previous_status' => $d->previous_status,
                'snapshot' => $showContacts ? $d->snapshot : array_diff_key($d->snapshot ?? [], ['email' => 1, 'phone' => 1]),
                'ip_address' => $d->ip_address, 'user_agent' => $d->user_agent,
                'closed_by' => $d->closer?->name, 'restored_by' => $d->restorer?->name, 'restored_at' => $d->restored_at?->toIso8601String(), 'restore_note' => $d->restore_note,
                'current_status' => $d->user?->status,
                'counts' => ['messages' => (int) ($messages[$d->user_id] ?? 0), 'groups' => (int) ($groups[$d->user_id] ?? 0), 'sos' => (int) ($sos[$d->user_id] ?? 0)],
            ]),
            'totals' => [
                'closed' => AccountDeletion::where('institution_id', $me->institution_id)->where('status', 'closed')->count(),
                'restored' => AccountDeletion::where('institution_id', $me->institution_id)->where('status', 'restored')->count(),
                'last_30_days' => AccountDeletion::where('institution_id', $me->institution_id)->where('requested_at', '>=', now()->subDays(30))->count(),
            ],
            'filters' => $request->only(['q', 'status', 'type']),
            'can' => ['restore' => Access::can($me, 'members.suspend')],
        ]);
    }

    public function restore(Request $request, AccountDeletion $record): RedirectResponse
    {
        $me = $request->user();
        abort_unless($record->institution_id === (int) $me->institution_id && $record->status === 'closed', 404);
        abort_unless($record->user && Access::canOnUser($me, 'members.suspend', $record->user), 403);
        $note = $request->validate(['note' => 'required|string|max:500'])['note'];
        AccountClosure::restore($record, $me, $note);

        return back()->with('status', ($record->snapshot['name'] ?? 'The account').' is restored and can sign in again.');
    }

    public function export(Request $request): StreamedResponse
    {
        $rows = $this->query($request)->limit(20000)->get();
        $contacts = Access::can($request->user(), 'members.contact');
        AuditLog::record('account.deleted_exported', null, ['rows' => $rows->count()]);

        return response()->streamDownload(function () use ($rows, $contacts) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Name', 'Matric/staff number', 'Type', 'Faculty', 'Department/unit', 'Level', 'Email', 'Phone', 'Deleted on', 'From', 'Reason',
                'IP address', 'Status', 'Restored on', 'Restored by', 'Restore note']);
            foreach ($rows as $d) {
                $s = $d->snapshot ?? [];
                fputcsv($out, [$s['name'] ?? '', $s['identifier'] ?? '', $s['member_type'] ?? '', $s['faculty'] ?? '', $s['department'] ?? $s['admin_unit'] ?? '',
                    $s['level'] ?? '', $contacts ? ($s['email'] ?? '') : '', $contacts ? ($s['phone'] ?? '') : '', $d->requested_at->toDateTimeString(),
                    $d->source === 'app' ? 'Phone app' : ($d->source === 'admin' ? 'Admin' : 'Website'), $d->reason ?? '', $d->ip_address ?? '',
                    $d->status, $d->restored_at?->toDateTimeString() ?? '', $d->restorer?->name ?? '', $d->restore_note ?? '']);
            }
            fclose($out);
        }, 'deleted-accounts-'.now()->format('Y-m-d').'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
