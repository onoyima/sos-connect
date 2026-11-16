<?php

use App\Support\Sealed;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Personal data is stored encrypted: phone and WhatsApp numbers, what people write in SOS alerts and chat
 * requests, privacy requests, and platform chat messages (chat messages already were). Columns become text
 * (encrypted values are longer) and existing rows are encrypted in place. Phone numbers get a keyed fingerprint
 * (phone_index) so they can still be matched. Running it twice is safe: values already encrypted are skipped.
 */
return new class extends Migration
{
    private const COLUMNS = [
        'users' => ['phone', 'whatsapp'],
        'sos_alerts' => ['message', 'location_label', 'resolution_note'],
        'chat_requests' => ['message'],
        'data_requests' => ['details'],
        'platform_messages' => ['body'],
    ];

    public function up(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->text('phone')->nullable()->change();
            $t->text('whatsapp')->nullable()->change();
            if (! Schema::hasColumn('users', 'phone_index')) {
                $t->string('phone_index', 64)->nullable()->after('phone')->index();
            }
        });
        Schema::table('sos_alerts', function (Blueprint $t) {
            $t->text('message')->nullable()->change();
            $t->text('location_label')->nullable()->change();
            $t->text('resolution_note')->nullable()->change();
        });
        Schema::table('chat_requests', fn (Blueprint $t) => $t->text('message')->nullable()->change());

        foreach (self::COLUMNS as $table => $columns) {
            DB::table($table)->orderBy('id')->select(['id', ...$columns])->chunkById(500, function ($rows) use ($table, $columns) {
                foreach ($rows as $row) {
                    $set = [];
                    foreach ($columns as $c) {
                        if (! Sealed::isSealed($row->{$c})) {
                            $set[$c] = Sealed::seal($row->{$c});
                        }
                    }
                    if ($table === 'users') {
                        $set['phone_index'] = Sealed::phoneIndex(Sealed::open($row->phone));
                    }
                    if ($set) {
                        DB::table($table)->where('id', $row->id)->update($set);
                    }
                }
            });
        }
    }

    public function down(): void
    {
        // Decrypt again (columns stay text, which holds the plain values fine).
        foreach (self::COLUMNS as $table => $columns) {
            DB::table($table)->orderBy('id')->select(['id', ...$columns])->chunkById(500, function ($rows) use ($table, $columns) {
                foreach ($rows as $row) {
                    DB::table($table)->where('id', $row->id)->update(collect($columns)->mapWithKeys(fn ($c) => [$c => Sealed::open($row->{$c})])->all());
                }
            });
        }
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn('phone_index'));
    }
};
