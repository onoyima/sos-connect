<?php

namespace App\Services\PlatformChat;

use App\Models\User;
use App\Support\Access;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Who may use the platform chat, and who may start a conversation with whom.
 *
 *  - Platform owners (is_platform_admin) can chat with each other and with any school's admins, alone or in groups.
 *  - A school admin is someone who can change their school's settings everywhere in it ("settings.edit").
 *    School admins can start a conversation with the platform team, and reply in any conversation they are added to.
 *  - Nobody else sees the platform chat, and school admins can't start chats with other schools' admins directly.
 */
class PlatformChat
{
    public static function canUse(?User $user): bool
    {
        if (! $user || $user->status !== 'active') {
            return false;
        }
        if ($user->is_platform_admin) {
            return true;
        }
        if (! $user->institution_id || ! $user->institution?->isActive()) {
            return false;
        }

        return Access::canEverywhere($user, 'settings.edit');
    }

    public static function canStartWith(User $me, User $other): bool
    {
        if ($me->id === $other->id || ! self::canUse($me) || ! self::canUse($other)) {
            return false;
        }

        // At least one side is on the platform team.
        return (bool) ($me->is_platform_admin || $other->is_platform_admin);
    }

    /** People I can start a conversation with, matching the search. */
    public static function contacts(User $me, string $q = '', int $limit = 30): Collection
    {
        if (! self::canUse($me)) {
            return collect();
        }
        $query = User::query()->with('institution:id,name,short_code,status')
            ->where('id', '!=', $me->id)->where('status', 'active');
        if (! $me->is_platform_admin) {
            $query->where('is_platform_admin', true);
        } else {
            $query->where(fn ($w) => $w->where('is_platform_admin', true)->orWhereNotNull('institution_id'));
        }
        $q = trim($q);
        if ($q !== '') {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
            $query->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('email', 'like', $like)
                ->orWhereHas('institution', fn ($i) => $i->where('name', 'like', $like)->orWhere('short_code', 'like', $like)));
        }

        // Platform owners first; then check school admins one by one (fetch more than we show, as many won't qualify).
        return $query->orderByDesc('is_platform_admin')->orderBy('name')->limit($limit * 6)->get()
            ->filter(fn (User $u) => self::canStartWith($me, $u))->take($limit)->values();
    }

    /** How a person appears in the platform chat: their name and where they are from (never their role). */
    public static function person(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'where' => $u->is_platform_admin && ! $u->institution_id ? 'Platform team' : ($u->institution?->name ?? ''),
            'platform' => (bool) $u->is_platform_admin,
        ];
    }

    /** The one-to-one conversation between two people, if they already have one. */
    public static function directBetween(int $a, int $b): ?int
    {
        $id = DB::table('platform_threads as t')->where('t.is_group', false)
            ->whereExists(fn ($q) => $q->from('platform_thread_members')->whereColumn('thread_id', 't.id')->where('user_id', $a))
            ->whereExists(fn ($q) => $q->from('platform_thread_members')->whereColumn('thread_id', 't.id')->where('user_id', $b))
            ->value('t.id');

        return $id ? (int) $id : null;
    }
}
