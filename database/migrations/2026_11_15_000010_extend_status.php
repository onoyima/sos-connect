<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Status: photos, GIFs, videos and audio; and who sees it: people I've chatted with, my department, my faculty,
 * chosen groups, chosen people, or everyone, always minus anyone I hide it from.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('status_updates', function (Blueprint $table) {
            $table->string('media_type', 10)->nullable()->after('media_path'); // image | gif | video | audio
        });
        // Chosen groups and chosen people are stored as the people they include when it was posted.
        Schema::create('status_audience', function (Blueprint $table) {
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->primary(['status_update_id', 'user_id']);
            $table->index('user_id');
        });
        Schema::create('status_hidden', function (Blueprint $table) {
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->primary(['status_update_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('status_hidden');
        Schema::dropIfExists('status_audience');
        Schema::table('status_updates', fn (Blueprint $t) => $t->dropColumn('media_type'));
    }
};
