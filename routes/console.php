<?php

use App\Models\AuditLog;
use App\Models\Institution;
use App\Models\MeshEnvelope;
use App\Models\Message;
use App\Models\SosAlert;
use App\Models\StatusUpdate;
use App\Services\Mesh\MeshKeyring;
use App\Services\Sos\SosService;
use App\Support\CurrentInstitution;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('sos:platform-keys', function () {
    $pair = sodium_crypto_sign_keypair();
    $this->info('Add to .env (keep the SECRET only on the server, never in the app):');
    $this->line('SOS_PLATFORM_SIGN_SECRET='.base64_encode(sodium_crypto_sign_secretkey($pair)));
    $this->line('SOS_PLATFORM_SIGN_PUBLIC='.base64_encode(sodium_crypto_sign_publickey($pair)));
    $this->info('Put the PUBLIC value in mobile/.env (EXPO_PUBLIC_PLATFORM_PUBLIC_KEY) and edge-node/.env (PLATFORM_PUBLIC_KEY).');
})->purpose('Generate the Ed25519 key pair that signs device certificates');

Artisan::command('sos:edge-token {institution : short code} {location}', function (string $institution, string $location) {
    $i = Institution::where('short_code', strtoupper($institution))->firstOrFail();
    $user = \App\Models\User::create([
        'institution_id' => $i->id, 'auth_source' => 'local', 'member_type' => 'relay', 'title' => 'Edge node', 'status' => 'active',
        'name' => 'Relay: '.$location, 'external_id' => 'relay-'.\Illuminate\Support\Str::lower(\Illuminate\Support\Str::random(10)),
    ]);
    $token = $user->createToken('edge-node', ['mesh:relay'])->plainTextToken;
    AuditLog::record('edge.token_created', $user, ['location' => $location], $i->id);
    $this->info('API_TOKEN='.$token);
})->purpose('Create an upload-only token for an edge node at a Wi-Fi access point');

Artisan::command('sos:escalate', function (SosService $sos) {
    $n = CurrentInstitution::bypass(fn () => $sos->escalateStale());
    $n && $this->info("Escalated {$n} alert(s).");
})->purpose('Escalate SOS alerts nobody has acknowledged');

Artisan::command('sos:rotate-mesh-keys', function (MeshKeyring $keys) {
    Institution::where('status', 'active')->each(fn ($i) => $keys->current($i->id)); // rotates when older than the limit
})->purpose('Rotate institution mesh keys that are due');

Artisan::command('sos:prune', function () {
    CurrentInstitution::bypass(function () {
        Institution::each(function (Institution $i) {
            $days = fn (string $k) => now()->subDays($i->retentionDays($k));

            Message::withTrashed()->where('institution_id', $i->id)->where('created_at', '<', $days('messages'))->forceDelete();
            StatusUpdate::where('institution_id', $i->id)->where('expires_at', '<', $days('status_updates'))->delete();
            SosAlert::where('institution_id', $i->id)->whereNull('location_blurred_at')->where('raised_at', '<', $days('sos_locations'))
                ->whereNotIn('status', SosAlert::OPEN_STATES)
                ->update(['lat' => DB::raw('ROUND(lat, 2)'), 'lng' => DB::raw('ROUND(lng, 2)'), 'location_blurred_at' => now()]); // ~1 km
            SosAlert::where('institution_id', $i->id)->where('raised_at', '<', $days('sos_alerts'))->delete();
            DB::table('call_logs')->where('institution_id', $i->id)->where('started_at', '<', $days('call_logs'))->delete();
            AuditLog::where('institution_id', $i->id)->where('created_at', '<', $days('audit_logs'))->delete();
        });
        MeshEnvelope::where('expires_at', '<', now())->delete();

        // Face capture: export files are removed after a day; unfinished captures after a day.
        foreach (\App\Models\FaceExport::whereNotNull('path')->where('created_at', '<', now()->subDay())->get() as $x) {
            \Illuminate\Support\Facades\Storage::disk('local')->delete($x->path);
            $x->update(['path' => null]);
        }
        $faces = app(\App\Services\Faces\FaceStore::class);
        \App\Models\FaceEnrollment::where('status', 'in_progress')->where('created_at', '<', now()->subDay())->get()->each(fn ($e) => $faces->deleteEnrollment($e));
    });
    $this->info('Retention applied.');
})->purpose('Delete or blur data past its retention period');

Schedule::command('sos:escalate')->everyMinute()->withoutOverlapping();
Schedule::command('sos:rotate-mesh-keys')->dailyAt('02:10');
Schedule::command('sos:prune')->dailyAt('03:20')->withoutOverlapping();
Schedule::command('sos:sync-structure')->dailyAt('01:40')->withoutOverlapping();

// Brings in new or renamed faculties, departments, units, hostels and courses from each institution's records.
// Runs nightly for institutions that switched on automatic sync; admins can also press "Sync from records".
Artisan::command('sos:sync-structure {institution? : short code; empty = every institution with automatic sync on}',
    function (?string $institution, \App\Services\Structure\StructureSync $sync) {
        $list = $institution
            ? \App\Models\Institution::with('connector')->where('short_code', strtoupper($institution))->get()
            : \App\Models\Institution::with('connector')->where('status', 'active')->whereHas('connector')->get()->filter(fn ($i) => $i->settings['auto_sync'] ?? true);
        foreach ($list as $inst) {
            try {
                $this->info("{$inst->short_code}: ".\App\Services\Structure\StructureSync::summary($sync->fromRecords($inst)));
            } catch (\Throwable $e) {
                report($e);
                $this->error("{$inst->short_code}: ".$e->getMessage());
            }
        }
    })->purpose('Bring in faculties, departments, units, hostels and courses from institution records');

// Brings people, chats, groups, messages and notices across from the previous campus chat system (comm_* tables).
// Re-runnable: what's already been brought across is skipped. Without --database it reads the institution's
// records database (Admin > Settings > Your records), where the old chat tables usually live.
Artisan::command('sos:import-campus-chat {institution : short code}
        {--host=127.0.0.1} {--port=3306} {--database= : old chat database (default: the institution records database)} {--username=root}
        {--files-url= : address the old chat server served /uploads from, to link old photos and files}
        {--dry-run : count what would be brought across without changing anything}',
    function (string $institution, \App\Services\Import\CampusChatImport $import) {
        $inst = \App\Models\Institution::where('short_code', strtoupper($institution))->firstOrFail();
        if ($this->option('database')) {
            $db = ['driver' => 'mysql', 'host' => $this->option('host'), 'port' => $this->option('port'), 'database' => $this->option('database'),
                'username' => $this->option('username'), 'password' => (string) $this->secret('Password for '.$this->option('username').' (leave empty for none)')];
        } else {
            $db = $inst->connector?->db_settings;
            if (! $db) {
                $this->error('Give --database (and --host, --username), or connect the records database in Admin > Settings first.');

                return 1;
            }
        }
        config(['database.connections.campus_chat_import' => array_merge(['charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'strict' => false], $db,
            ($db['driver'] ?? 'mysql') === 'sqlite' ? [] : ['driver' => 'mysql'])]);
        $old = \Illuminate\Support\Facades\DB::connection('campus_chat_import');
        if (! $old->getSchemaBuilder()->hasTable('comm_messages')) {
            $this->error('No comm_messages table in that database. Is it the old chat database?');

            return 1;
        }
        $this->info(($this->option('dry-run') ? 'Dry run: nothing will be changed. ' : '')."Importing into {$inst->name}…");
        $n = $import->run($inst, $old, $this->option('files-url'), (bool) $this->option('dry-run'), fn ($line) => $this->line($line));
        $this->table(['What', 'Count'], collect($n)->map(fn ($v, $k) => [str_replace('_', ' ', $k), $v])->values()->all());

        return 0;
    })->purpose('Bring people, chats and messages across from the previous campus chat');

/*
 * Live updates in one step: fills in the websocket server settings in .env the first time (random keys, local
 * addresses), so chats, SOS and calls update instantly. Safe to run again; existing values are kept.
 */
Artisan::command('sos:realtime-setup {--force : Replace existing keys}', function () {
    $path = base_path('.env');
    if (! is_file($path)) {
        $this->error('No .env file. Copy .env.example to .env first.');

        return 1;
    }
    $env = file_get_contents($path);
    $get = function (string $key) use (&$env): ?string {
        return preg_match('/^'.preg_quote($key, '/').'=(.*)$/m', $env, $m) ? trim($m[1], " \t\"'") : null;
    };
    $set = function (string $key, string $value) use (&$env): void {
        $line = $key.'='.$value;
        $env = preg_match('/^'.preg_quote($key, '/').'=.*$/m', $env)
            ? preg_replace('/^'.preg_quote($key, '/').'=.*$/m', str_replace('$', '\$', $line), $env)
            : rtrim($env)."\n".$line."\n";
    };
    $force = (bool) $this->option('force');
    $local = in_array($get('REVERB_HOST'), [null, '', 'ws.sos.example.com', '127.0.0.1', 'localhost'], true);

    $set('BROADCAST_CONNECTION', 'reverb');
    foreach (['REVERB_APP_ID' => fn () => (string) random_int(100000, 999999), 'REVERB_APP_KEY' => fn () => \Illuminate\Support\Str::lower(\Illuminate\Support\Str::random(20)),
        'REVERB_APP_SECRET' => fn () => \Illuminate\Support\Str::lower(\Illuminate\Support\Str::random(32))] as $key => $make) {
        if ($force || ! $get($key) || $get($key) === 'sos-connect') {
            $set($key, $make());
        }
    }
    if ($local) {
        // The app talks to the websocket server on this computer; browsers and phones use this computer's address.
        $set('REVERB_HOST', '127.0.0.1');
        $set('REVERB_PORT', '8080');
        $set('REVERB_SCHEME', 'http');
        $set('REVERB_SERVER_HOST', '0.0.0.0');
        $set('REVERB_SERVER_PORT', '8080');
    }
    file_put_contents($path, $env);
    $this->call('config:clear');
    $this->info('Live updates are set up'.($local ? ' for this computer (port 8080).' : '.'));
    $this->line('Start everything with: php artisan sos:serve');
})->purpose('Turn on live updates (websocket server settings in .env)');

/*
 * Starts the website and the live-update server together in one terminal (plus a queue worker when the queue
 * isn't "sync"). Ctrl+C stops them all.
 */
Artisan::command('sos:serve {--host=0.0.0.0 : Address to listen on (0.0.0.0 = reachable from phones on the same Wi-Fi)} {--port=8000}', function () {
    if (config('broadcasting.default') !== 'reverb' || ! config('broadcasting.connections.reverb.key')) {
        $this->warn('Live updates were off. Setting them up now...');
        $this->call('sos:realtime-setup');
        $this->warn('Settings changed: run php artisan sos:serve again to start with live updates.');

        return 0;
    }
    if (! is_file(public_path('mediapipe/face_landmarker.task'))) {
        $this->call('sos:face-model'); // once; face capture also works without it (the page then loads the model from Google)
    }
    $php = (new \Symfony\Component\Process\PhpExecutableFinder)->find(false) ?: 'php';
    $artisan = base_path('artisan');
    $procs = [
        'web' => [$php, $artisan, 'serve', '--host='.$this->option('host'), '--port='.$this->option('port')],
        'live' => [$php, $artisan, 'reverb:start', '--host='.(env('REVERB_SERVER_HOST') ?: '0.0.0.0'), '--port='.(env('REVERB_SERVER_PORT') ?: 8080)],
    ];
    if (config('queue.default') !== 'sync') {
        $procs['queue'] = [$php, $artisan, 'queue:work', '--tries=3', '--sleep=1'];
    }

    $running = [];
    foreach ($procs as $name => $cmd) {
        $p = new \Symfony\Component\Process\Process($cmd, base_path(), null, null, null);
        $p->start();
        $running[$name] = $p;
    }
    $stop = function () use (&$running) {
        foreach ($running as $p) {
            if ($p->isRunning()) {
                $p->stop(3);
            }
        }
    };
    register_shutdown_function($stop);
    if (function_exists('pcntl_signal')) {
        pcntl_async_signals(true);
        pcntl_signal(SIGINT, function () use ($stop) { $stop(); exit(0); });
        pcntl_signal(SIGTERM, function () use ($stop) { $stop(); exit(0); });
    }

    $this->info('SOS Connect is running.');
    $this->line('  Website:       http://localhost:'.$this->option('port').' (other devices on the Wi-Fi: http://<this computer\'s IP>:'.$this->option('port').')');
    $this->line('  Live updates:  port '.(env('REVERB_SERVER_PORT') ?: 8080).' (allow it in Windows Firewall so phones can connect)');
    $this->line('  Press Ctrl+C to stop.');

    $colors = ['web' => 'green', 'live' => 'cyan', 'queue' => 'yellow'];
    while (true) {
        foreach ($running as $name => $p) {
            foreach ([$p->getIncrementalOutput(), $p->getIncrementalErrorOutput()] as $out) {
                foreach (array_filter(explode("\n", $out), fn ($l) => trim($l) !== '') as $line) {
                    $this->line("<fg={$colors[$name]}>[{$name}]</> ".rtrim($line));
                }
            }
            if (! $p->isRunning()) {
                $this->error("[{$name}] stopped (exit code ".$p->getExitCode().'). Restarting...');
                sleep(1);
                $running[$name] = $p->restart();
            }
        }
        usleep(200_000);
    }
})->purpose('Start the website and live updates together');

/*
 * Face capture runs a face-tracking model in the browser. This keeps a copy on this server, so the capture page works
 * on a campus network without reaching Google, and loads faster. Official model from Google's MediaPipe.
 */
Artisan::command('sos:face-model {--force : Download again}', function () {
    $dest = public_path('mediapipe/face_landmarker.task');
    if (is_file($dest) && ! $this->option('force')) {
        $this->info('Face model already here: '.$dest);

        return 0;
    }
    $url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    $this->line('Downloading the face model (about 4 MB)...');
    try {
        $res = \Illuminate\Support\Facades\Http::timeout(120)->withOptions(['sink' => $dest.'.part'])->get($url);
    } catch (\Throwable $e) {
        @unlink($dest.'.part');
        $this->warn('Could not download the face model ('.$e->getMessage().'). Face capture will load it from Google instead.');

        return 0;
    }
    $head = (string) @file_get_contents($dest.'.part', false, null, 0, 2);
    if (! $res->successful() || filesize($dest.'.part') < 1_000_000 || $head !== 'PK') {
        @unlink($dest.'.part');
        $this->warn('The face model download failed. Face capture will load it from Google instead. Try again later: php artisan sos:face-model');

        return 0;
    }
    rename($dest.'.part', $dest);
    $this->info('Face model saved: '.$dest);

    return 0;
})->purpose('Download the face-tracking model used by face capture');
