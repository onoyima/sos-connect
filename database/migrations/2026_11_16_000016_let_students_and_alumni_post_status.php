<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Students and alumni can post status updates. Institutions set up before status existed (and every Alumni role)
 * were missing this, so their students and graduates couldn't post on the website or the app. An admin can still
 * take it away again under Admin > Roles.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('roles')->whereIn('default_for', ['student', 'alumni'])->pluck('id') as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'status.post']);
        }
    }

    public function down(): void
    {
        // Left in place: removing it could take away something an admin chose to give.
    }
};
