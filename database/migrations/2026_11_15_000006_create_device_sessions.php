<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One phone and one web browser per account at a time. The phone is the main device: a browser can be
 * linked to it by scanning a QR code (not for admin accounts, which sign in to the website with a password).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('web_session_id', 120)->nullable();
            $table->string('web_session_via', 10)->nullable();   // password | qr
            $table->timestamp('web_session_at')->nullable();
            $table->string('web_session_agent', 190)->nullable();
            $table->string('web_session_ip', 45)->nullable();
        });

        Schema::create('web_links', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('browser', 64);                    // hash of the waiting browser's session
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('status', 12)->default('pending'); // pending | approved | used
            $table->string('ip', 45)->nullable();
            $table->string('agent', 190)->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('approved_at')->nullable();
            $table->timestamps();
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web_links');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['web_session_id', 'web_session_via', 'web_session_at', 'web_session_agent', 'web_session_ip']);
        });
    }
};
