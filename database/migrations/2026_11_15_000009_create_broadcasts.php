<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Messages from the institution that stand out: a pop-up shown every time the app is opened (until it is paused
 * or ends), and a marquee: a thin line sliding across the top that never blocks chats or calls. Each goes to an
 * audience (everyone, students, staff, a faculty, department, unit or hostel, a level).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('broadcasts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('kind', 10);                // popup | marquee
            $table->string('style', 12)->default('info'); // info | urgent | celebration
            $table->string('title', 160)->nullable();
            $table->text('body');
            $table->string('link_url', 300)->nullable();
            $table->string('link_label', 60)->nullable();
            $table->json('audience');
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'kind', 'paused_at']);
        });

        foreach (DB::table('roles')->whereIn('slug', ['institution_admin', 'registrar'])->pluck('id') as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'broadcasts.manage']);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->where('permission', 'broadcasts.manage')->delete();
        Schema::dropIfExists('broadcasts');
    }
};
