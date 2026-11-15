<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform chat: conversations between the platform owners (who belong to no school) and each school's admins,
 * and among the platform owners themselves. Deliberately separate from the schools' own chats, which never
 * cross from one school to another.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_threads', function (Blueprint $table) {
            $table->id();
            $table->string('title', 120)->nullable();      // groups only
            $table->boolean('is_group')->default(false);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_message_at')->nullable()->index();
            $table->timestamps();
        });

        Schema::create('platform_thread_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('platform_threads')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('last_read_id')->default(0);
            $table->timestamps();
            $table->unique(['thread_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('platform_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('platform_threads')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamps();
            $table->index(['thread_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_messages');
        Schema::dropIfExists('platform_thread_members');
        Schema::dropIfExists('platform_threads');
    }
};
