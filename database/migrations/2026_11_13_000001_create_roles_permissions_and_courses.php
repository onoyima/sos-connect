<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Roles and permissions, per institution.
 *
 *  - permissions are fixed keys in code (App\Support\PermissionCatalog), e.g. "members.view".
 *  - roles are bundles of those keys that each institution can create and edit.
 *  - role_assignments give a role to a person, over the whole institution or one area (a faculty,
 *    department or admin unit and everything inside it), optionally until a date.
 *  - user_permissions add (grant) or take away (deny) a single permission for one person, also per area.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('slug', 80);
            $table->string('description', 300)->nullable();
            $table->boolean('is_super')->default(false);      // every permission, always; cannot be edited away
            $table->boolean('is_system')->default(false);     // shipped role: can be edited but not deleted
            $table->string('default_for', 20)->nullable();    // student | staff | parent: given automatically
            $table->boolean('dm_protected')->default(false);  // students can't start private chats with holders (VC, Registrar)
            $table->unsignedSmallInteger('rank')->default(100); // lower = more senior; used for the display title
            $table->timestamps();
            $table->unique(['institution_id', 'slug']);
        });

        Schema::create('role_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->string('permission', 60);
            $table->unique(['role_id', 'permission']);
        });

        Schema::create('role_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('org_unit_id')->nullable()->constrained('org_units')->cascadeOnDelete(); // null = whole institution
            $table->dateTime('expires_at')->nullable();
            $table->string('source', 20)->default('manual'); // manual | connector | default
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 300)->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'role_id']);
            $table->index(['user_id', 'expires_at']);
        });

        Schema::create('user_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('permission', 60);
            $table->string('effect', 10)->default('grant'); // grant | deny (deny beats any role)
            $table->foreignId('org_unit_id')->nullable()->constrained('org_units')->cascadeOnDelete();
            $table->dateTime('expires_at')->nullable();
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 300)->nullable();
            $table->timestamps();
            $table->index(['user_id', 'permission']);
        });

        // Courses belong to a department; each one can have its own chat group.
        Schema::create('courses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('org_unit_id')->nullable()->constrained('org_units')->nullOnDelete(); // owning department
            $table->string('external_id', 64)->nullable();
            $table->string('code', 20);                 // PHY 101
            $table->string('title', 160);
            $table->unsignedSmallInteger('level')->nullable();
            $table->unsignedTinyInteger('semester')->nullable();
            $table->timestamps();
            $table->unique(['institution_id', 'code']);
        });

        // Parents/guardians are linked to the students they look after.
        Schema::create('guardian_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('student_id')->constrained('users')->cascadeOnDelete();
            $table->string('relationship', 40)->nullable();
            $table->timestamps();
            $table->unique(['parent_id', 'student_id']);
        });

        // One-time links that let an invited person (e.g. a parent) set their own password.
        Schema::create('invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('token_hash', 64)->unique();
            $table->dateTime('expires_at');
            $table->dateTime('accepted_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // What was brought in from an older system (e.g. the previous campus chat), so an import can be re-run safely.
        Schema::create('import_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->string('source', 40);            // campus-chat
            $table->string('kind', 30);              // identity | conversation | message | announcement
            $table->string('legacy_id', 64);
            $table->unsignedBigInteger('local_id');
            $table->timestamps();
            $table->unique(['institution_id', 'source', 'kind', 'legacy_id']);
        });
    }

    public function down(): void
    {
        foreach (['import_links', 'invitations', 'guardian_links', 'courses', 'user_permissions', 'role_assignments', 'role_permissions', 'roles'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
