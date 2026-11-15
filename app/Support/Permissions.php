<?php

namespace App\Support;

use App\Models\User;

/**
 * Short names kept for older call sites. The real work is in Access (who can do what, where) and
 * PermissionCatalog (the list of permissions).
 */
final class Permissions
{
    /** May the user do this anywhere? For a specific area or person use Access::can / Access::canOnUser. */
    public static function allows(?User $user, string $permission): bool
    {
        return Access::can($user, $permission);
    }

    /** Everything the user may do somewhere, sent to the apps to show or hide buttons. */
    public static function for(User $user): array
    {
        return Access::list($user);
    }
}
