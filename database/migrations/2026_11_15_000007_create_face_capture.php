<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Face capture: each student or staff member records a guided set of face photos (front, left, right, up, down,
 * mouth open, front again) with liveness checks (blink, mouth). Photos are stored encrypted. The admin sends them
 * to the school's own systems as an encrypted file or straight into a table in the school's database.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('face_enrollments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->string('status', 15)->default('in_progress'); // in_progress | complete | superseded
            $table->string('device', 10)->default('web');          // web | phone
            $table->json('liveness')->nullable();                   // blinks, mouth, turns, how long it took
            $table->decimal('quality', 5, 2)->nullable();           // 0-100, from sharpness, light and face size
            $table->string('consent_version', 20)->nullable();
            $table->timestamp('consent_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('exported_file_at')->nullable();
            $table->timestamp('exported_db_at')->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        Schema::create('face_captures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('face_enrollment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('pose', 20);                 // front | left | right | up | down | mouth | front_final
            $table->string('path', 190);                // encrypted file on the private disk
            $table->string('mime', 40)->default('image/jpeg');
            $table->unsignedSmallInteger('width');
            $table->unsignedSmallInteger('height');
            $table->unsignedInteger('bytes');
            $table->char('sha256', 64);
            $table->json('metrics')->nullable();        // yaw, pitch, roll, sharpness, brightness, face size, eyes, mouth
            $table->longText('landmarks')->nullable();  // 478 face points (x, y, z) in the photo, for the school's systems
            $table->timestamps();
            $table->unique(['face_enrollment_id', 'pose']);
        });

        Schema::create('face_exports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('kind', 10);                  // file | database
            $table->string('scope', 20);                 // new | all
            $table->string('status', 12)->default('queued'); // queued | running | done | failed
            $table->unsignedInteger('people')->default(0);
            $table->unsignedInteger('images')->default(0);
            $table->string('path', 190)->nullable();     // the encrypted ZIP (file exports), removed after a day
            $table->string('error', 500)->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'created_at']);
        });

        Schema::table('institution_connectors', function (Blueprint $table) {
            $table->text('face_db_settings')->nullable(); // where "Send to school database" writes (encrypted)
        });

        // Roles that existed before: students and staff may capture their face; institution admins see and send them.
        foreach (DB::table('roles')->whereIn('default_for', ['student', 'staff'])->pluck('id') as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'face.capture']);
        }
        foreach (DB::table('roles')->where('slug', 'institution_admin')->pluck('id') as $id) {
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'faces.view']);
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $id, 'permission' => 'faces.export']);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->whereIn('permission', ['face.capture', 'faces.view', 'faces.export'])->delete();
        Schema::table('institution_connectors', fn (Blueprint $t) => $t->dropColumn('face_db_settings'));
        Schema::dropIfExists('face_exports');
        Schema::dropIfExists('face_captures');
        Schema::dropIfExists('face_enrollments');
    }
};
