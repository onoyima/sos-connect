<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\Realtime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * "Anything new?" Used by pages and phones when the websocket server can't be reached (and every half minute
 * as a safety net when it can). Returns small fingerprints of what changed, plus any signals meant for me
 * (call ringing and setup, status activity). Cheap: a handful of indexed MAX() queries, no message content.
 */
class PulseController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $me = $request->user();
        $iid = $me->institution_id;
        [$cursor, $signals] = Realtime::since($me->id, (int) $request->query('after', -1));

        $mine = DB::table('conversation_members')->where('user_id', $me->id)->select('conversation_id');
        $msg = DB::table('messages')->whereIn('conversation_id', $mine)
            ->selectRaw('MAX(id) as id, MAX(edited_at) as edited, MAX(deleted_at) as deleted')->first();
        $members = DB::table('conversation_members')->where('user_id', $me->id)->selectRaw('COUNT(*) as n, MAX(id) as t')->first();
        $requests = DB::table('chat_requests')->where(fn ($q) => $q->where('to_id', $me->id)->orWhere('from_id', $me->id))->max('updated_at');
        $at = fn (string $table, string $col = 'updated_at') => DB::table($table)->where('institution_id', $iid)->max($col);

        return response()->json([
            'cursor' => $cursor,
            'signals' => $signals,
            'stamps' => [
                'messages' => implode('|', [$msg->id, $msg->edited, $msg->deleted]),
                'conversations' => implode('|', [$members->n, $members->t, $requests]),
                'sos' => implode('|', [$at('sos_alerts'), DB::table('sos_responses')->whereIn('sos_alert_id',
                    DB::table('sos_alerts')->where('institution_id', $iid)->select('id'))->max('id')]),
                // First part = newest id, so a page can tell "a new one" from "one was edited".
                'announcements' => implode('|', [$at('announcements', 'id'), $at('announcements')]),
                'safety' => implode('|', [$at('safety_checks', 'id'), $at('safety_checks'), DB::table('safety_check_responses')->whereIn('safety_check_id',
                    DB::table('safety_checks')->where('institution_id', $iid)->select('id'))->max('id')]),
                'status' => implode('|', [$at('status_updates', 'id'), DB::table('status_updates')->where('institution_id', $iid)->count(),
                    DB::table('status_comments')->where('institution_id', $iid)->max('id'),
                    DB::table('status_reactions')->whereIn('status_update_id', DB::table('status_updates')->where('institution_id', $iid)->select('id'))->max('updated_at')]),
            ],
            'realtime' => Realtime::clientSettings(),
            'badges' => \App\Support\Badges::for($me),
            // So the page can listen to each chat for instant updates.
            'conversation_ids' => DB::table('conversation_members')->where('user_id', $me->id)->pluck('conversation_id'),
        ]);
    }

    public function badges(Request $request): JsonResponse
    {
        return response()->json(['badges' => \App\Support\Badges::for($request->user())]);
    }

    /** How to connect to the live-update server (for the phone app). */
    public function settings(): JsonResponse
    {
        return response()->json(['realtime' => Realtime::clientSettings()]);
    }
}
