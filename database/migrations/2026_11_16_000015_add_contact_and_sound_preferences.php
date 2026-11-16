<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * - whatsapp: the number a member wants others to reach them on (WhatsApp). The school's phone number (users.phone,
 *   from the records) is never changed; this one, if set, is shown instead. show_whatsapp: hide it entirely.
 * - preferences: per-person settings that follow them to every device (e.g. which tone plays for messages and calls).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('whatsapp', 32)->nullable();
            $table->boolean('show_whatsapp')->default(true);
            $table->json('preferences')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['whatsapp', 'show_whatsapp', 'preferences']));
    }
};
