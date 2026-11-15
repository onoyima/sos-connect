<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Group calls (everyone in a call connects to everyone else; the server only relays the setup messages), and the
 * social side of status updates: tagged people, likes and loves, and comments with replies.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('group_calls', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->uuid('call_uuid')->unique();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('started_by')->constrained('users')->cascadeOnDelete();
            $table->string('type', 10);                 // voice | video
            $table->dateTime('started_at');
            $table->dateTime('ended_at')->nullable();
            $table->timestamps();
            $table->index(['conversation_id', 'ended_at']);
        });

        Schema::create('group_call_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_call_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->dateTime('joined_at');
            $table->dateTime('seen_at');                // refreshed while they're in the call; stale = they dropped
            $table->dateTime('left_at')->nullable();
            $table->unique(['group_call_id', 'user_id']);
        });

        Schema::table('status_updates', function (Blueprint $table) {
            $table->string('background', 9)->nullable()->after('media_path'); // colour behind a text status
        });

        Schema::create('status_mentions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unique(['status_update_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('status_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('reaction', 10);             // like | love
            $table->timestamps();
            $table->unique(['status_update_id', 'user_id']);
        });

        Schema::create('status_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reply_to_id')->nullable()->constrained('status_comments')->nullOnDelete();
            $table->text('body');
            $table->timestamps();
            $table->index(['status_update_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('status_comments');
        Schema::dropIfExists('status_reactions');
        Schema::dropIfExists('status_mentions');
        Schema::table('status_updates', fn (Blueprint $table) => $table->dropColumn('background'));
        Schema::dropIfExists('group_call_participants');
        Schema::dropIfExists('group_calls');
    }
};
