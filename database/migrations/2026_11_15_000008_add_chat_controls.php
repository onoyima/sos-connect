<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-person chat controls: mute for a while or always, archive (moves a chat out of the main list), and pause
 * (new messages in that chat are held back, with no alerts or red counts, until I resume). Also lets the sender of
 * a chat request see the answer (accepted or declined) the next time they open the app.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversation_members', function (Blueprint $table) {
            $table->timestamp('muted_until')->nullable();              // null with muted = always
            $table->timestamp('archived_at')->nullable();
            $table->unsignedBigInteger('paused_after_message_id')->nullable(); // set while paused: newer messages are held back
        });
        Schema::table('chat_requests', function (Blueprint $table) {
            $table->timestamp('sender_seen_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('conversation_members', fn (Blueprint $t) => $t->dropColumn(['muted_until', 'archived_at', 'paused_after_message_id']));
        Schema::table('chat_requests', fn (Blueprint $t) => $t->dropColumn('sender_seen_at'));
    }
};
