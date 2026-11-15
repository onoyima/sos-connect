<?php

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Finds or starts the one-to-one chat between two people, with the same rules wherever it's started from. */
class DirectChats
{
    /**
     * @param  bool  $accepted  true when the other person just accepted a chat request (the rules are already met)
     */
    public static function open(User $me, User $peer, bool $accepted = false): Conversation
    {
        abort_if($peer->id === $me->id, 422, 'You cannot start a chat with yourself.');
        abort_if($peer->institution_id !== $me->institution_id, 404);

        if (! $accepted) {
            [$mode, $why] = ContactPolicy::decide($me, $peer);
            if ($mode === ContactPolicy::REQUEST) {
                abort(response()->json([
                    'message' => "Send {$peer->name} a chat request first. You can chat and call once they accept.",
                    'needs_request' => true,
                ], 403));
            }
            abort_if($mode === ContactPolicy::NONE, 403, $why ?? 'You cannot chat with this person.');
        }

        return DB::transaction(function () use ($me, $peer) {
            $c = Conversation::firstOrCreate(['direct_key' => Conversation::directKey($me->id, $peer->id)], ['type' => 'direct', 'created_by' => $me->id]);
            foreach ([$me->id, $peer->id] as $uid) {
                ConversationMember::firstOrCreate(['conversation_id' => $c->id, 'user_id' => $uid], ['joined_at' => now()]);
            }

            return $c;
        });
    }
}
