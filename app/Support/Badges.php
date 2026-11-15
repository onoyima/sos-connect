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
            ->where('cm.muted', false)
            ->whereRaw('m.id > COALESCE(cm.last_read_message_id, 0)')
            ->where('m.sender_id', '!=', $me->id)->whereNull('m.deleted_at')
            ->distinct()->count('m.conversation_id');

        // Missed, or still "ringing" long after the caller gave up (their app closed before it could say so).
        $calls = (int) DB::table('call_logs')->where('callee_id', $me->id)
            ->where(fn ($q) => $q->where('status', 'missed')->orWhere(fn ($r) => $r->where('status', 'ringing')->where('started_at', '<', now()->subMinutes(2))))
            ->when($me->calls_seen_at, fn ($q) => $q->where('started_at', '>', $me->calls_seen_at))
            ->where('started_at', '>', now()->subDays(14))->count();

        $requests = (int) DB::table('chat_requests')->where('to_id', $me->id)->where('status', 'pending')->count();

        return ['chats' => $chats, 'calls' => $calls, 'requests' => $requests];
    }
}
