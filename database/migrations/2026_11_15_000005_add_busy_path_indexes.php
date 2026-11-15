<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Indexes for the queries that run on every page open and every live check (badges, missed calls, status rings). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('call_logs', function (Blueprint $table) {
            $table->index(['callee_id', 'status', 'started_at'], 'call_logs_missed_idx');
        });
        Schema::table('status_updates', function (Blueprint $table) {
            $table->index(['institution_id', 'user_id', 'expires_at'], 'status_updates_feed_idx');
        });
    }

    public function down(): void
    {
        Schema::table('call_logs', fn (Blueprint $t) => $t->dropIndex('call_logs_missed_idx'));
        Schema::table('status_updates', fn (Blueprint $t) => $t->dropIndex('status_updates_feed_idx'));
    }
};
