<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** The red counts: chats with unread messages, missed calls since I last looked, chat requests waiting for me. */
class Badges
{
    public static function for(User $me): array
    {
        $chats = (int) DB::table('messages as m')
            ->join('conversation_members as cm', fn ($j) => $j->on('cm.conversation_id', '=', 'm.conversation_id')->where('cm.user_id', $me->id))
            ->where(fn ($q) => $q->where('cm.muted', false)->orWhere(fn ($r) => $r->whereNotNull('cm.muted_until')->where('cm.muted_until', '<=', now())))
            ->whereNull('cm.paused_after_message_id')->whereNull('cm.archived_at')
            ->whereRaw('m.id > COALESCE(cm.last_read_message_id, 0)')
            ->where('m.sender_id', '!=', $me->id)->whereNull('m.deleted_at')
            ->distinct()->count('m.conversation_id');

        // Missed, or still "ringing" long after the caller gave up (their app closed before it could say so).
        $calls = (int) DB::table('call_logs')->where('callee_id', $me->id)
            ->where(fn ($q) => $q->where('status', 'missed')->orWhere(fn ($r) => $r->where('status', 'ringing')->where('started_at', '<', now()->subMinutes(2))))
            ->when($me->calls_seen_at, fn ($q) => $q->where('started_at', '>', $me->calls_seen_at))
            ->where('started_at', '>', now()->subDays(14))->count();

        // Requests waiting for my answer, plus answers to my requests I haven't seen yet.
        $requests = (int) DB::table('chat_requests')->where('to_id', $me->id)->where('status', 'pending')->count()
            + (int) DB::table('chat_requests')->where('from_id', $me->id)->whereIn('status', ['accepted', 'declined'])
                ->whereNull('sender_seen_at')->where('responded_at', '>', now()->subDays(14))->count();

        // SOS alerts still going on that I'm meant to see (campus security, wardens, admins…), not my own.
        $sos = 0;
        if ($me->institution_id && Access::can($me, 'sos.view')) {
            $sos = (int) \App\Models\SosAlert::query()->visibleTo($me)->whereIn('status', \App\Models\SosAlert::OPEN_STATES)
                ->where('user_id', '!=', $me->id)->where('raised_at', '>', now()->subDay())->count();
        }

        return ['chats' => $chats, 'calls' => $calls, 'requests' => $requests, 'sos' => $sos];
    }
}
