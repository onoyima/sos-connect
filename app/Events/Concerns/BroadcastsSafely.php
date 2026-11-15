<?php

namespace App\Events\Concerns;

use Throwable;

/**
 * Realtime is a bonus, never a requirement. If the websocket server (Reverb) is down or not
 * installed, the message / SOS is already saved, so we log the failure and carry on instead of
 * returning an error to the person who pressed SOS. Phones still get it through sync and the mesh.
 */
trait BroadcastsSafely
{
    public static function dispatch(...$arguments)
    {
        try {
            return event(new static(...$arguments));
        } catch (Throwable $e) {
            // Once a minute is enough to notice "the websocket server is down"; pages fall back to checking for changes.
            if (\Illuminate\Support\Facades\Cache::add('rt:down-reported', 1, 60)) {
                report($e);
            }

            return null;
        }
    }
}
