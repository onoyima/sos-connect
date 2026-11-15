<?php

namespace App\Support;

use Illuminate\Cache\RateLimiter;

/**
 * Used outside production: attempts are still counted, but nobody is ever blocked, so testing and fixing forms
 * locally never ends in "Too many requests". Production keeps the normal limits (sign-in, registration, API).
 */
class RelaxedRateLimiter extends RateLimiter
{
    public function tooManyAttempts($key, $maxAttempts)
    {
        return false;
    }
}
