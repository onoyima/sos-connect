<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Software-as-a-service billing, run by the platform owner:
 *  - plans: the packages (which features, how many members, prices per month / year),
 *  - subscriptions: each institution's plan and where it is (trial, active, overdue, lapsed, cancelled),
 *  - invoices: what is owed and how it was paid (bank transfer, waived, online through Paystack),
 *  - platform_settings: the owner's switches (enforce subscriptions, trial and grace days, currency, payment methods).
 *
 * Existing institutions keep every feature they have today: they move onto the plan with everything, as a fresh
 * trial. Nothing is enforced until the owner switches "Enforce subscriptions" on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 40)->unique();
            $table->string('name', 80);
            $table->string('description', 400)->nullable();
            $table->unsignedBigInteger('price_monthly')->default(0);   // smallest unit (kobo, cents)
            $table->unsignedBigInteger('price_yearly')->default(0);
            $table->unsignedInteger('max_members')->nullable();        // students + staff; null = no limit
            $table->json('modules');                                    // feature keys included (SOS is always included)
            $table->unsignedSmallInteger('trial_days')->nullable();    // null = the platform default
            $table->boolean('is_public')->default(true);               // schools can see and choose it
            $table->boolean('is_active')->default(true);               // archived plans keep their schools but take no new ones
            $table->unsignedSmallInteger('position')->default(100);
            $table->timestamps();
        });

        Schema::create('subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->string('status', 12)->default('trialing');          // trialing | active | past_due | expired | cancelled
            $table->string('cycle', 8)->default('yearly');              // monthly | yearly
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->timestamp('past_due_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->boolean('cancel_at_period_end')->default(false);
            $table->unsignedInteger('max_members_override')->nullable(); // a negotiated member limit
            $table->unsignedBigInteger('price_override')->nullable();    // a negotiated price per cycle
            $table->string('notes', 1000)->nullable();                   // platform team only
            $table->timestamps();
            $table->index(['status', 'trial_ends_at']);
            $table->index(['status', 'current_period_end']);
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('institution_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->string('number', 30)->unique();
            $table->string('description', 200);
            $table->string('cycle', 8)->nullable();
            $table->unsignedBigInteger('amount');
            $table->string('currency', 3);
            $table->string('status', 8)->default('open');               // open | paid | void
            $table->timestamp('period_start')->nullable();
            $table->timestamp('period_end')->nullable();
            $table->timestamp('due_at')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->string('method', 16)->nullable();                   // bank_transfer | cash | cheque | waived | paystack | other
            $table->string('reference', 120)->nullable();
            $table->string('gateway_reference', 120)->nullable()->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('notes', 500)->nullable();
            $table->timestamps();
            $table->index(['institution_id', 'status']);
            $table->index(['status', 'due_at']);
        });

        Schema::create('platform_settings', function (Blueprint $table) {
            $table->string('key', 60)->primary();
            $table->json('value')->nullable();
            $table->timestamps();
        });

        $now = now();
        $all = ['communities', 'general_groups', 'student_groups', 'staff_groups', 'level_groups', 'course_groups', 'admin_unit_groups',
            'hostel_groups', 'parents', 'announcements', 'broadcasts', 'direct_chat', 'custom_groups', 'chat_requests', 'mute_chats',
            'archive_chats', 'pause_chats', 'file_sharing', 'voice_notes', 'stickers', 'status', 'status_interactions', 'voice_calls',
            'video_calls', 'group_calls', 'safety_checks', 'face_capture', 'face_capture_required', 'offline_mesh'];
        $basic = ['communities', 'general_groups', 'student_groups', 'staff_groups', 'announcements', 'direct_chat', 'custom_groups',
            'chat_requests', 'mute_chats', 'archive_chats', 'pause_chats', 'file_sharing', 'voice_notes', 'stickers', 'status',
            'safety_checks', 'offline_mesh', 'voice_calls'];
        $standard = array_values(array_diff($all, ['face_capture', 'face_capture_required', 'parents']));

        // Prices start at 0: the owner sets real prices under Platform > Plans before switching enforcement on.
        DB::table('plans')->insert([
            ['slug' => 'starter', 'name' => 'Starter', 'description' => 'Chat, groups, notices, status, voice calls and SOS for a small institution.',
                'price_monthly' => 0, 'price_yearly' => 0, 'max_members' => 2000, 'modules' => json_encode($basic), 'trial_days' => null,
                'is_public' => true, 'is_active' => true, 'position' => 10, 'created_at' => $now, 'updated_at' => $now],
            ['slug' => 'standard', 'name' => 'Standard', 'description' => 'Everything in Starter, plus video and group calls, level, course, hostel and unit groups, pop-ups and marquee.',
                'price_monthly' => 0, 'price_yearly' => 0, 'max_members' => 15000, 'modules' => json_encode($standard), 'trial_days' => null,
                'is_public' => true, 'is_active' => true, 'position' => 20, 'created_at' => $now, 'updated_at' => $now],
            ['slug' => 'enterprise', 'name' => 'Enterprise', 'description' => 'Every feature, including parents and guardians and face capture, with no member limit.',
                'price_monthly' => 0, 'price_yearly' => 0, 'max_members' => null, 'modules' => json_encode($all), 'trial_days' => null,
                'is_public' => true, 'is_active' => true, 'position' => 30, 'created_at' => $now, 'updated_at' => $now],
        ]);

        $defaults = [
            'billing.enforce' => false,            // off: plans and payments are tracked, but nothing is limited or switched off
            'billing.currency' => 'NGN',
            'billing.trial_days' => 30,
            'billing.grace_days' => 14,             // overdue this long before the subscription lapses
            'billing.default_plan' => 'standard',   // new institutions start their trial on this plan
            'billing.default_cycle' => 'yearly',
            'billing.lapse_limits_features' => true, // lapsed: only notices, safety checks and SOS keep working
            'billing.self_service' => true,         // school admins can choose a public plan themselves
            'billing.reminder_days' => 7,           // remind admins this many days before a trial or period ends
            'payments.online' => false,             // Paystack (needs PAYSTACK_SECRET_KEY in .env)
            'payments.bank_transfer' => true,
            'payments.bank_details' => '',
            'payments.invoice_due_days' => 14,
        ];
        foreach ($defaults as $k => $v) {
            DB::table('platform_settings')->insert(['key' => $k, 'value' => json_encode($v), 'created_at' => $now, 'updated_at' => $now]);
        }

        // Existing institutions: every feature they have today, as a trial; nothing changes until enforcement is on.
        $enterprise = DB::table('plans')->where('slug', 'enterprise')->value('id');
        foreach (DB::table('institutions')->pluck('id') as $id) {
            DB::table('subscriptions')->insert([
                'institution_id' => $id, 'plan_id' => $enterprise, 'status' => 'trialing', 'cycle' => 'yearly',
                'trial_ends_at' => $now->copy()->addDays(30), 'created_at' => $now, 'updated_at' => $now,
                'notes' => 'Moved onto subscriptions with all of its existing features.',
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('subscriptions');
        Schema::dropIfExists('platform_settings');
        Schema::dropIfExists('plans');
    }
};
