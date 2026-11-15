<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One row per institution (tenant). Every other business table carries institution_id.
        Schema::create('institutions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('short_code', 20)->unique();          // e.g. "ABC"; used in admin screens and commands, never listed publicly
            $table->char('country', 2)->default('NG');
            $table->json('email_domains')->nullable();            // ["school.edu"]: how the sign-in page recognises members by email
            $table->string('status', 20)->default('pending');    // pending | active | suspended
            $table->string('contact_name');
            $table->string('contact_email');
            $table->string('contact_phone', 30)->nullable();
            $table->string('dpo_name')->nullable();
            $table->string('dpo_email')->nullable();
            $table->string('security_phone', 30)->nullable();     // campus security line, used by the SMS fallback
            $table->json('settings')->nullable();
            $table->timestamp('dpa_accepted_at')->nullable();
            $table->string('dpa_accepted_by')->nullable();
            $table->string('dpa_version', 20)->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });

        // How we verify logins against the institution's own system. We never store member passwords.
        Schema::create('institution_connectors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('base_url');             // https://... for a separate connector, or "direct"
            $table->string('key_id', 64);
            $table->text('secret');                 // encrypted cast
            // Direct mode: this app reads the institution's records database itself (all encrypted).
            $table->text('db_settings')->nullable(); // {driver, host, port, database, username, password}
            $table->string('query_set', 40)->nullable(); // which SQL set in connector/queries describes their system
            $table->boolean('sync_directory')->default(false); // institution opts in to a directory sync
            $table->timestamp('last_tested_at')->nullable();
            $table->boolean('last_test_ok')->default(false);
            $table->string('last_error')->nullable();
            $table->timestamps();
        });

        // Faculties / departments / admin units mirrored from the institution (names and ids only).
        Schema::create('org_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            // faculty | department | admin_department (ICT, Bursary...) | hostel | custom
            $table->string('type', 30);
            $table->string('external_id', 64);
            $table->foreignId('parent_id')->nullable()->constrained('org_units')->nullOnDelete();
            $table->string('name');
            $table->string('code', 30)->nullable();
            $table->timestamps();
            $table->unique(['institution_id', 'type', 'external_id']);
        });

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->nullable()->constrained()->cascadeOnDelete(); // null = platform staff
            $table->string('external_id', 64)->nullable();         // student/staff id in the institution's system
            $table->string('auth_source', 20)->default('connector'); // connector | local
            $table->string('member_type', 20);                     // student | staff | parent | admin | relay
            $table->string('name');
            $table->string('email')->nullable();
            $table->string('identifier')->nullable();               // matric number / staff number shown to admins
            $table->string('phone', 30)->nullable();
            $table->string('password')->nullable();                 // only for local accounts (institution admins, platform staff)
            // What a person can do comes from role_assignments + user_permissions, never from a column here.
            // `title` is only a display label kept in step with their roles, e.g. "HOD, Physics".
            $table->string('title', 160)->nullable();
            $table->boolean('is_platform_admin')->default(false);  // our own team (institution_id is null)
            $table->foreignId('faculty_unit_id')->nullable()->constrained('org_units')->nullOnDelete();
            $table->foreignId('department_unit_id')->nullable()->constrained('org_units')->nullOnDelete();
            $table->foreignId('admin_unit_id')->nullable()->constrained('org_units')->nullOnDelete(); // ICT, Bursary... for staff
            $table->foreignId('hostel_unit_id')->nullable()->constrained('org_units')->nullOnDelete(); // hostel this session
            $table->string('residence', 160)->nullable();   // "Hall A, room B12": shown to responders on an SOS
            $table->string('programme', 160)->nullable();   // e.g. Physics with Electronics; or a staff member's position
            $table->unsignedSmallInteger('level')->nullable();
            $table->string('status', 20)->default('active');        // active | suspended | left
            $table->boolean('is_minor')->default(false);
            $table->timestamp('guardian_consent_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->string('policy_version', 20)->nullable();
            $table->timestamp('policy_accepted_at')->nullable();
            $table->unsignedInteger('token_version')->default(1);   // bump to revoke every token and certificate
            $table->rememberToken();
            $table->timestamps();

            $table->unique(['institution_id', 'external_id']);
            $table->unique(['institution_id', 'email']);
            $table->index(['institution_id', 'member_type']);
            $table->index(['institution_id', 'department_unit_id', 'level']);
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->text('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
        });

        // Each phone holds its own signing + encryption keys; the server certifies them.
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->string('device_uid', 64);
            $table->string('platform', 20);
            $table->string('sign_public_key', 64);  // base64 Ed25519
            $table->string('box_public_key', 64);   // base64 X25519
            $table->string('push_token')->nullable();
            $table->timestamp('cert_expires_at')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'device_uid']);
            $table->index(['institution_id', 'revoked_at']);
        });

        // Institution-wide symmetric keys used to encrypt mesh traffic (rotated monthly and on suspensions).
        Schema::create('mesh_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->string('key_id', 16)->unique();
            $table->text('secret');                 // encrypted cast
            $table->dateTime('active_from');
            $table->timestamp('retired_at')->nullable();
            $table->timestamps();
        });

        Schema::create('consents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 30);             // terms | privacy | sos_location | guardian
            $table->string('version', 20);
            $table->boolean('granted');
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'kind']);
        });

        Schema::create('data_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 20);             // export | erasure | rectification | objection | restriction
            $table->string('status', 20)->default('received');
            $table->text('details')->nullable();
            $table->dateTime('due_at');             // statutory deadline
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->nullable()->index();
            $table->foreignId('actor_id')->nullable()->index();
            $table->string('action', 60)->index();
            $table->string('target_type', 40)->nullable();
            $table->unsignedBigInteger('target_id')->nullable();
            $table->json('meta')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->dateTime('created_at')->useCurrent()->index();
        });
    }

    public function down(): void
    {
        foreach (['audit_logs', 'data_requests', 'consents', 'mesh_keys', 'devices', 'personal_access_tokens',
            'sessions', 'password_reset_tokens', 'users', 'org_units', 'institution_connectors', 'institutions'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
