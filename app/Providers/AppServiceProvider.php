<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Rate limits (sign-in, registration, API) only block people in production, unless SOS_RATE_LIMITS=true.
        if (! (config('sos.rate_limits') ?? $this->app->isProduction())) {
            $this->app->extend(\Illuminate\Cache\RateLimiter::class, fn ($limiter, $app) => new \App\Support\RelaxedRateLimiter(
                $app->make('cache')->driver($app['config']->get('cache.limiter'))));
        }
    }

    public function boot(): void
    {
        // Limits are per signed-in user, not per IP: a whole hostel shares one campus NAT address.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(300)->by($request->user()?->id ?: $request->ip()));

        Model::preventLazyLoading(! $this->app->isProduction());
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());
    }
}
