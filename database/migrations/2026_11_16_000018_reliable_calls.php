<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Calls connect even when the live-update server can't deliver: the call's progress and its setup messages
 * (WebRTC offer/answer and network candidates) are kept here, and both phones/browsers check every second
 * during a call.
 *  - rang_at: the person being called has the call on their screen (the caller then hears ringing, not "calling").
 *  - active_at: last sign of life from either side, so a call that was never ended properly doesn't mark
 *    someone "busy" for hours.
 *  - call_signals: setup messages for one side, deleted when the call ends (and after a day at most).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('call_logs', function (Blueprint $t) {
            $t->timestamp('rang_at')->nullable()->after('started_at');
            $t->timestamp('active_at')->nullable()->after('ended_at');
        });
        Schema::create('call_signals', function (Blueprint $t) {
            $t->id();
            $t->uuid('call_uuid');
            $t->foreignId('to_user_id')->constrained('users')->cascadeOnDelete();
            $t->text('data'); // encrypted (it holds network addresses)
            $t->timestamp('created_at')->nullable();
            $t->index(['call_uuid', 'to_user_id', 'id']);
            $t->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('call_signals');
        Schema::table('call_logs', fn (Blueprint $t) => $t->dropColumn(['rang_at', 'active_at']));
    }
};
