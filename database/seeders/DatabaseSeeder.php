<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Only the platform operator account (the team that runs the service: approves institutions, never reads
     * their messages). Institutions register themselves at /register-institution and connect their own records;
     * nothing about any institution is seeded.
     */
    public function run(): void
    {
        $email = env('SEED_PLATFORM_ADMIN_EMAIL', 'admin@sos.example.com');
        $password = env('SEED_PLATFORM_ADMIN_PASSWORD') ?: Str::password(14, symbols: false);
        $admin = User::firstOrNew(['email' => $email, 'institution_id' => null]);
        if (! $admin->exists) {
            $admin->fill(['auth_source' => 'local', 'member_type' => 'admin', 'name' => 'Platform Operator', 'password' => $password,
                'title' => 'Platform operator', 'status' => 'active']);
            $admin->forceFill(['is_platform_admin' => true])->save(); // never mass-assignable
        }
        if ($admin->wasRecentlyCreated) {
            $this->command?->warn("Platform operator: {$email} / {$password}  (sign in at /login)");
        }
    }
}
