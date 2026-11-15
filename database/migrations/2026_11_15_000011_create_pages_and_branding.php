<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Help pages (for everyone, or only staff, students or admins) and the design document (admins only), both
 * editable by admins at any time. Starts from the built-in versions in resources/help and docs/design.md.
 * Also lets admins change the favicon and chat icon (kept in the institution's settings).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 10);                         // help | design
            $table->string('slug', 120);
            $table->string('title', 160);
            $table->longText('body');                           // Markdown
            $table->string('audience', 10)->default('everyone'); // everyone | students | staff | admins
            $table->unsignedSmallInteger('position')->default(100);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['institution_id', 'kind', 'slug']);
        });

        foreach (DB::table('roles')->where('slug', 'institution_admin')->pluck('id') as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'help.manage']);
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'design.view']);
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'branding.manage']);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->whereIn('permission', ['help.manage', 'design.view', 'branding.manage'])->delete();
        Schema::dropIfExists('pages');
    }
};
