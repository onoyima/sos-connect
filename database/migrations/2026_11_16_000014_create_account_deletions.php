<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Delete my account" closes the account (status "deleted") instead of erasing it, so the institution can always
 * trace it. Each closure is kept here for good, with a snapshot of who the person was at that moment, and whether
 * (and by whom) it was restored. Erasing data is a separate request handled by the institution's data protection officer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_deletions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('requested_at');
            $table->string('source', 10);                 // web | app | admin
            $table->string('reason', 1000)->nullable();
            $table->string('previous_status', 20)->nullable();
            $table->json('snapshot');                      // name, numbers, contacts, faculty, department, level… at the time
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete(); // an admin, when closed for them
            $table->foreignId('data_request_id')->nullable()->constrained('data_requests')->nullOnDelete();
            $table->string('status', 10)->default('closed'); // closed | restored
            $table->timestamp('restored_at')->nullable();
            $table->foreignId('restored_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('restore_note', 500)->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'status', 'requested_at']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_deletions');
    }
};
