<?php

namespace App\Services\Auth;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Brute-force protection for sign-in, in three layers:
 *  - one account from one address: 5 wrong passwords, then a 15-minute wait;
 *  - one account from anywhere (attackers rotating addresses): SECURITY_LOGIN_PER_ACCOUNT per hour;
 *  - one address across many accounts (password spraying): SECURITY_LOGIN_PER_IP per hour.
 * A correct password clears only the first two, so spraying from one address stays limited.
 */
final class LoginGuard
{
    private array $keys;

    public function __construct(private Request $request, string $identifier)
    {
        $who = hash('sha256', mb_strtolower(trim($identifier)));
        $ip = (string) $request->ip();
        $this->keys = [
            'pair' => ["login:pair:{$ip}|{$who}", 5, 900],
            'account' => ["login:acct:{$who}", max(5, (int) config('sos.security.login_per_account', 15)), 3600],
            'ip' => ["login:ip:{$ip}", max(10, (int) config('sos.security.login_per_ip', 40)), 3600],
        ];
    }

    /** null when the attempt may go ahead, otherwise what to tell the person. */
    public function blocked(): ?string
    {
        foreach ($this->keys as [$key, $max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                $min = max(1, (int) ceil(RateLimiter::availableIn($key) / 60));

                return "Too many sign-in attempts. Try again in {$min} minute".($min === 1 ? '' : 's').'.';
            }
        }

        return null;
    }

    public function failed(): void
    {
        foreach ($this->keys as $name => [$key, $max, $decay]) {
            RateLimiter::hit($key, $decay);
            if (RateLimiter::attempts($key) === $max) {
                Log::warning('Sign-in limit reached', ['limit' => $name, 'ip' => $this->request->ip()]);
            }
        }
        if (! app()->runningUnitTests()) {
            usleep(random_int(150_000, 400_000)); // slows guessing and hides timing differences
        }
    }

    public function succeeded(): void
    {
        RateLimiter::clear($this->keys['pair'][0]);
        RateLimiter::clear($this->keys['account'][0]);
    }
}
