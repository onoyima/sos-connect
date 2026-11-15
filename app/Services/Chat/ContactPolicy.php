<?php

namespace App\Services\Chat;

use App\Models\ChatRequest;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Access\RoleManager;
use App\Support\Access;

/**
 * Who may chat with (and call) whom, straight away or only after the other person accepts a chat request.
 *
 *   Staff  -> any student ..................................... straight away
 *   Staff  -> staff in the same department, faculty or unit .... straight away
 *   Staff  -> staff elsewhere .................................. request first
 *   Student -> student, Student -> staff ...................... request first
 *   Anyone with "Chat and call without a request" over the person (registrar, deans, HODs, heads of units,
 *   institution admins, responders: see Admin > Roles) ........ straight away
 *   An existing one-to-one chat (or an accepted request) ....... straight away, both ways
 *
 * Students can't reach offices marked "students use official channels" (e.g. Vice-Chancellor) at all; parents
 * are reached through the parents group unless the sender may contact them.
 */
class ContactPolicy
{
    public const DIRECT = 'direct';

    public const REQUEST = 'request';

    public const NONE = 'none';

    /** @return array{0: string, 1: ?string} [direct|request|none, why not (for people)] */
    public static function decide(User $me, User $peer): array
    {
        if ($peer->id === $me->id || $peer->institution_id !== $me->institution_id) {
            return [self::NONE, "You can't start a chat with yourself."];
        }
        if (! $peer->isActive() || in_array($peer->member_type, ['relay'], true)) {
            return [self::NONE, 'This person can no longer be reached here.'];
        }
        if (! Access::can($me, 'chat.use')) {
            return [self::NONE, "Chat isn't on for your account yet."];
        }
        if (self::alreadyTalking($me, $peer)) {
            return [self::DIRECT, null];
        }
        if ($peer->member_type === 'parent') {
            return Access::canOnUser($me, 'members.contact', $peer) ? [self::DIRECT, null] : [self::NONE, 'Parents can be reached through the parents group.'];
        }
        if (! Access::can($me, 'chat.direct')) {
            return [self::NONE, 'Private chats are turned off for you.'];
        }
        if (Access::canOnUser($me, 'chat.anyone', $peer)) {
            return [self::DIRECT, null];
        }

        $learner = fn (User $u) => in_array($u->member_type, ['student', 'alumni'], true);
        if ($learner($me)) {
            if (RoleManager::isProtectedFromStudents($peer)) {
                return [self::NONE, 'Students can reach this office through official groups or the SOS button.'];
            }

            return [self::REQUEST, null];
        }
        if ($learner($peer)) {
            return [self::DIRECT, null]; // staff may message any student
        }

        return self::sameUnit($me, $peer) ? [self::DIRECT, null] : [self::REQUEST, null];
    }

    public static function mode(User $me, User $peer): string
    {
        return self::decide($me, $peer)[0];
    }

    /** Staff who share a department, faculty or admin unit. */
    public static function sameUnit(User $a, User $b): bool
    {
        foreach (['department_unit_id', 'faculty_unit_id', 'admin_unit_id'] as $col) {
            if ($a->{$col} && $a->{$col} === $b->{$col}) {
                return true;
            }
        }

        return false;
    }

    /** A one-to-one chat already exists, or one of them accepted the other's request. */
    public static function alreadyTalking(User $a, User $b): bool
    {
        return Conversation::where('direct_key', Conversation::directKey($a->id, $b->id))->exists()
            || ChatRequest::between($a->id, $b->id)->where('status', 'accepted')->exists();
    }
}
