<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Chat requests: someone who may not message a person straight away (student to student, student to staff, staff
 * to staff in another department) asks first; the chat (and calls) open once the other person accepts.
 * Also gives the new "Chat and call without a request" permission to the heads and offices that need it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('from_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('to_id')->constrained('users')->cascadeOnDelete();
            $table->string('message', 300)->nullable();       // a short "who I am / why"
            $table->string('status', 10)->default('pending');  // pending | accepted | declined | cancelled
            $table->dateTime('responded_at')->nullable();
            $table->foreignId('conversation_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['to_id', 'status']);
            $table->index(['from_id', 'status']);
        });

        // Roles that existed before this permission: the heads and offices get it (admins can change this in Admin > Roles).
        $roles = DB::table('roles')->whereIn('slug', ['institution_admin', 'vice_chancellor', 'registrar', 'dean_student_affairs', 'dean', 'hod',
            'unit_head', 'security', 'health_centre', 'counsellor'])->pluck('id');
        foreach ($roles as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'chat.anyone']);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->where('permission', 'chat.anyone')->delete();
        Schema::dropIfExists('chat_requests');
    }
};
