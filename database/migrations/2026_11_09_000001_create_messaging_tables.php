<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            // direct | group (made by people) | auto_group (made from records) | community (holds groups)
            $table->string('type', 20);
            $table->string('name')->nullable();
            $table->string('description', 500)->nullable();
            $table->foreignId('parent_id')->nullable()->constrained('conversations')->nullOnDelete(); // community it sits in
            $table->string('auto_key', 120)->nullable(); // e.g. "dept:12:students" — unique per institution
            // What kind of automatic group this is; used by feature switches (e.g. turn off all level groups).
            // community | announcements | general | students | staff | parents | level | course | unit_staff
            $table->string('auto_type', 30)->nullable();
            $table->string('scope', 30)->nullable();    // institution | faculty | department | admin_department | course
            $table->foreignId('org_unit_id')->nullable()->constrained('org_units')->nullOnDelete();
            $table->unsignedSmallInteger('level')->nullable();
            $table->string('posting', 20)->default('everyone'); // everyone | admins (announcement-only)
            $table->boolean('enabled')->default(true);          // admins can switch a single group off
            $table->boolean('name_locked')->default(false);     // renamed by an admin: don't follow the records' name
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('direct_key', 64)->nullable(); // "minId:maxId" for direct chats
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->unique(['institution_id', 'auto_key']);
            $table->unique(['institution_id', 'direct_key']);
            $table->index(['institution_id', 'last_message_at']);
            $table->index(['institution_id', 'parent_id']);
        });

        Schema::create('conversation_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20)->default('member'); // admin | member
            // What this group admin may do: post, members, settings, delete_messages, admins. Null = all of them.
            $table->json('admin_permissions')->nullable();
            $table->boolean('managed')->default(false);   // added by auto-group sync (sync never touches role)
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('last_read_message_id')->nullable();
            $table->boolean('muted')->default(false);
            $table->dateTime('joined_at')->useCurrent();
            $table->unique(['conversation_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            $table->uuid('client_id');                   // generated on the phone; makes online + mesh delivery idempotent
            $table->string('type', 20)->default('text'); // text | image | voice | file | system
            $table->text('body')->nullable();            // encrypted at rest
            $table->json('meta')->nullable();            // attachments, mentions [{id,name}], legacy import info
            $table->unsignedBigInteger('reply_to_id')->nullable(); // the message this one answers (same conversation)
            $table->string('via', 10)->default('online'); // online | mesh | gateway
            $table->dateTime('sent_at');                // device clock when written
            $table->timestamp('edited_at')->nullable();
            $table->softDeletes();
            $table->timestamps();

            $table->unique(['sender_id', 'client_id']);
            $table->index(['conversation_id', 'id']);
        });

        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->text('body');
            $table->json('audience');                    // {"type":"all"} | {"type":"staff"} | {"type":"department","id":12}
            $table->string('priority', 10)->default('normal'); // normal | urgent
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'published_at']);
        });

        Schema::create('status_updates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('body')->nullable();
            $table->string('media_path')->nullable();
            $table->string('audience', 20)->default('contacts'); // contacts | department | institution
            $table->dateTime('expires_at')->index();
            $table->timestamps();
        });

        Schema::create('status_views', function (Blueprint $table) {
            $table->id();
            $table->foreignId('status_update_id')->constrained()->cascadeOnDelete();
            $table->foreignId('viewer_id')->constrained('users')->cascadeOnDelete();
            $table->dateTime('viewed_at')->useCurrent();
            $table->unique(['status_update_id', 'viewer_id']);
        });

        Schema::create('call_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->uuid('call_uuid')->unique();
            $table->foreignId('caller_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('callee_id')->constrained('users')->cascadeOnDelete();
            $table->string('type', 10);                  // voice | video
            $table->string('status', 15)->default('ringing'); // ringing | answered | missed | rejected | busy | ended | failed
            $table->string('via', 10)->default('online'); // online | lan
            $table->dateTime('started_at');
            $table->timestamp('answered_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();
            $table->index(['caller_id', 'started_at']);
            $table->index(['callee_id', 'started_at']);
        });

        Schema::create('message_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reporter_id')->constrained('users')->cascadeOnDelete();
            $table->string('target_type', 20);           // message | status | user
            $table->unsignedBigInteger('target_id');
            $table->string('reason', 500);
            $table->string('status', 20)->default('open');
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['message_reports', 'call_logs', 'status_views', 'status_updates', 'announcements', 'messages',
            'conversation_members', 'conversations'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
