<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sos_alerts', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('client_id');
            $table->string('category', 20);              // medical | fire | security | harassment | accident | other
            $table->string('message', 500)->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->unsignedInteger('accuracy_m')->nullable();
            $table->string('location_label')->nullable(); // "Hostel B, room 12" typed by the user
            $table->string('status', 20)->default('open'); // open | acknowledged | responding | resolved | false_alarm | cancelled
            $table->string('via', 10)->default('online'); // online | mesh | gateway | sms
            $table->dateTime('raised_at');
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamp('escalated_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('resolution_note', 1000)->nullable();
            $table->timestamp('location_blurred_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'client_id']);
            $table->index(['institution_id', 'status', 'raised_at']);
        });

        Schema::create('sos_responses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sos_alert_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('action', 20);                // acknowledged | on_my_way | arrived | note | resolved | false_alarm
            $table->string('note', 1000)->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->timestamps();
        });

        // "Are you safe?" campaigns sent by the institution during an incident (fire, flood, unrest).
        Schema::create('safety_checks', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->string('message', 1000);
            $table->json('audience');
            $table->dateTime('closes_at');
            $table->timestamps();
        });

        Schema::create('safety_check_responses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('safety_check_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('answer', 15);                // safe | need_help
            $table->string('note', 500)->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->string('via', 10)->default('online');
            $table->dateTime('responded_at');
            $table->unique(['safety_check_id', 'user_id']);
        });

        // Envelopes uploaded by any phone that reached the internet ("gateway") on behalf of offline peers.
        Schema::create('mesh_envelopes', function (Blueprint $table) {
            $table->id();
            $table->string('envelope_id', 32)->unique();  // hex of the 16-byte id
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('sender_device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('gateway_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedTinyInteger('type');
            $table->string('to_kind', 2);
            $table->string('to_id', 64);
            $table->longText('payload');                  // the full envelope as received (still encrypted)
            $table->string('result', 30)->nullable();     // materialised | sealed_for_recipient | rejected:<reason>
            $table->timestamp('processed_at')->nullable();
            $table->dateTime('expires_at')->index();
            $table->timestamps();
            $table->index(['to_kind', 'to_id', 'processed_at']);
        });
    }

    public function down(): void
    {
        foreach (['mesh_envelopes', 'safety_check_responses', 'safety_checks', 'sos_responses', 'sos_alerts'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
