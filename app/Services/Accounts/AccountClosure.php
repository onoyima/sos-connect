<?php

namespace App\Services\Accounts;

use App\Models\AccountDeletion;
use App\Models\AuditLog;
use App\Models\DataRequest;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Closing an account ("Delete my account") never erases it: the status becomes "deleted", the person is signed out
 * everywhere and hidden from others, and everything they did stays for the institution to trace. A snapshot of who
 * they were is kept in account_deletions. An erasure request is logged for the institution's data protection officer,
 * who decides (within the legal deadline) what may actually be erased.
 */
class AccountClosure
{
    public static function close(User $user, string $source, ?string $reason = null, ?User $by = null, ?Request $request = null): AccountDeletion
    {
        return DB::transaction(function () use ($user, $source, $reason, $by, $request) {
            $user->loadMissing(['faculty:id,name', 'department:id,name', 'adminUnit:id,name']);
            $previous = $user->status;

            $dataRequest = DataRequest::create([
                'institution_id' => $user->institution_id, 'user_id' => $user->id, 'type' => 'erasure', 'status' => 'received',
                'details' => trim('Closed their account'.($source === 'app' ? ' in the phone app' : ($source === 'admin' ? ' (closed by an admin)' : ' on the website'))
                    .($reason ? ". Reason: {$reason}" : '.').' The account is kept, closed, until this request is decided.'),
                'due_at' => now()->addDays(30),
            ]);

            $record = AccountDeletion::create([
                'institution_id' => $user->institution_id, 'user_id' => $user->id, 'requested_at' => now(), 'source' => $source,
                'reason' => $reason ? mb_substr($reason, 0, 1000) : null, 'previous_status' => $previous,
                'snapshot' => self::snapshot($user),
                'ip_address' => $request?->ip(), 'user_agent' => $request ? mb_substr((string) $request->userAgent(), 0, 255) : null,
                'closed_by' => $by?->id, 'data_request_id' => $dataRequest->id, 'status' => 'closed',
            ]);

            $user->forceFill(['status' => 'deleted'])->save();
            // Signed out everywhere: phone sign-ins, the linked browser, and push notifications stop.
            $user->tokens()->delete();
            $user->devices()->whereNull('revoked_at')->update(['revoked_at' => now(), 'push_token' => null]);
            DeviceSessions::endWeb($user);

            AuditLog::record('account.deleted', $user, ['source' => $source, 'reason' => $reason, 'record' => $record->id], $user->institution_id);

            return $record;
        });
    }

    public static function restore(AccountDeletion $record, User $by, ?string $note = null): void
    {
        DB::transaction(function () use ($record, $by, $note) {
            $user = User::findOrFail($record->user_id);
            $back = in_array($record->previous_status, ['active', 'suspended'], true) ? $record->previous_status : 'active';
            $user->forceFill(['status' => $back])->save();
            $record->update(['status' => 'restored', 'restored_at' => now(), 'restored_by' => $by->id, 'restore_note' => $note]);
            if ($record->data_request_id) {
                DataRequest::where('id', $record->data_request_id)->where('status', 'received')
                    ->update(['status' => 'withdrawn', 'completed_at' => now()]);
            }
            AuditLog::record('account.restored', $user, ['record' => $record->id, 'note' => $note], $user->institution_id);
        });
    }

    /** Who the person was when they closed the account, so the record still makes sense if details change later. */
    public static function snapshot(User $u): array
    {
        return [
            'name' => $u->name, 'identifier' => $u->identifier, 'email' => $u->email, 'phone' => $u->phone,
            'member_type' => $u->member_type, 'title' => $u->title, 'level' => $u->level, 'programme' => $u->programme,
            'faculty' => $u->faculty?->name, 'department' => $u->department?->name, 'admin_unit' => $u->adminUnit?->name,
            'residence' => $u->residence, 'external_id' => $u->external_id, 'auth_source' => $u->auth_source,
            'joined_at' => $u->created_at?->toIso8601String(), 'last_seen_at' => $u->last_seen_at?->toIso8601String(),
        ];
    }
}
