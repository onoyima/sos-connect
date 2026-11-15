<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Graduates (level 1000 and above in the records) sign in as alumni. They are grouped by the year below:
 * their graduation year when the records hold it ("graduated"), otherwise the year they started ("entry").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedSmallInteger('alumni_year')->nullable()->after('level');
            $table->string('alumni_year_kind', 10)->nullable()->after('alumni_year'); // graduated | entry
            $table->index(['institution_id', 'member_type', 'alumni_year']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['institution_id', 'member_type', 'alumni_year']);
            $table->dropColumn(['alumni_year', 'alumni_year_kind']);
        });
    }
};
