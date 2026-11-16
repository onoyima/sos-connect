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
Schedule::command('sos:billing')->hourly()->withoutOverlapping();

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

Artisan::command('sos:doctor', function () {
    // Checks the things that make features fail on a live server, and says how to fix each one.
    $bad = 0;
    $warn = 0;
    $ok = fn (string $m) => $this->line("  <fg=green>✓</> {$m}");
    $fail = function (string $m, string $fix) use (&$bad) { $bad++; $this->line("  <fg=red>✗</> {$m}"); $this->line("      → {$fix}"); };
    $note = function (string $m, string $fix) use (&$warn) { $warn++; $this->line("  <fg=yellow>!</> {$m}"); $this->line("      → {$fix}"); };

    $this->info('Database');
    try {
        \Illuminate\Support\Facades\DB::connection()->getPdo();
        $ok('Connected to '.config('database.default'));
        $migrator = app('migrator');
        $files = $migrator->getMigrationFiles(database_path('migrations'));
        $ran = $migrator->getRepository()->repositoryExists() ? $migrator->getRepository()->getRan() : [];
        $pending = array_diff(array_keys($files), $ran);
        $pending ? $fail(count($pending).' database update(s) not applied: '.implode(', ', array_slice($pending, 0, 5)).(count($pending) > 5 ? ' …' : ''),
            'php artisan migrate --force   (if it fails, send the error)') : $ok('All database updates applied');
    } catch (\Throwable $e) {
        $fail('Cannot use the database: '.$e->getMessage(), 'Check DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD in .env');
    }

    $this->info('Website');
    $url = (string) config('app.url');
    str_starts_with($url, 'https://') ? $ok("APP_URL {$url}") : $fail("APP_URL is {$url}", 'Set APP_URL=https://your-domain (camera, microphone and calls need https)');
    config('app.debug') && app()->isProduction() ? $fail('APP_DEBUG is on in production', 'Set APP_DEBUG=false') : $ok('Debug mode is right for '.app()->environment());
    $life = (int) config('session.lifetime');
    $life < 1440 ? $note("Sign-ins end after {$life} minutes without use", 'Set SESSION_LIFETIME=43200 (30 days), then php artisan config:cache') : $ok('Sign-ins last '.round($life / 1440).' days without use');

    $this->info('Security');
    app()->isProduction() ? $ok('APP_ENV=production') : $note('APP_ENV is '.app()->environment(), 'Set APP_ENV=production on the live server');
    strlen((string) config('app.key')) >= 40 ? $ok('App key set (encrypts sessions and personal data)') : $fail('APP_KEY is missing', 'php artisan key:generate (once; never change it afterwards, or encrypted data is lost)');
    config('session.secure') || ! app()->isProduction() ? $ok('Sign-in cookie only sent over https') : $fail('Sign-in cookie can be sent without https', 'Set SESSION_SECURE_COOKIE=true');
    config('session.encrypt') ? $ok('Sessions stored encrypted') : $note('Sessions are not encrypted', 'Set SESSION_ENCRYPT=true');
    config('session.http_only') ? $ok('Scripts cannot read the sign-in cookie') : $fail('SESSION_HTTP_ONLY is off', 'Set SESSION_HTTP_ONLY=true');
    config('sos.security.csp') === 'enforce' ? $ok('Content-Security-Policy enforced') : $note('Content-Security-Policy is '.config('sos.security.csp'), 'Set SECURITY_CSP=enforce');
    $maps = glob(public_path('build/assets/*.map')) ?: [];
    $maps ? $fail(count($maps).' source map files are published', 'Delete public/build/assets/*.map and rebuild (npm run build)') : $ok('No source maps published (the browser shows only minified code)');
    file_exists(public_path('.env')) || file_exists(public_path('storage/../.env')) ? $fail('.env is inside public/', 'Move it: the web root must be public/ only') : $ok('.env is not in the web root');
    \Illuminate\Support\Facades\Schema::hasColumn('users', 'phone_index') ? $ok('Personal data encryption is set up') : $fail('Personal data is not encrypted yet', 'php artisan migrate --force');

    $this->info('Files and uploads');
    foreach ([storage_path('app'), storage_path('app/private'), storage_path('framework/sessions'), storage_path('logs'), base_path('bootstrap/cache')] as $dir) {
        if (! is_dir($dir)) { @mkdir($dir, 0775, true); }
        is_dir($dir) && is_writable($dir) ? $ok('Writable: '.str_replace(base_path().'/', '', $dir))
            : $fail('Not writable: '.$dir, 'sudo chown -R <web-user>:<web-user> storage bootstrap/cache && sudo chmod -R ug+rwX storage bootstrap/cache');
    }
    try {
        \Illuminate\Support\Facades\Storage::disk('local')->put('doctor-check.txt', 'ok');
        \Illuminate\Support\Facades\Storage::disk('local')->delete('doctor-check.txt');
        $ok('Private files can be saved (face photos, exports)');
    } catch (\Throwable $e) {
        $fail('Private files cannot be saved: '.$e->getMessage(), 'Fix permissions on storage/app');
    }
    is_link(public_path('storage')) || is_dir(public_path('storage')) ? $ok('public/storage link exists') : $fail('public/storage link is missing (uploaded pictures and voice notes won\'t open)', 'php artisan storage:link');
    $toBytes = function ($v) { $v = trim((string) $v); $n = (float) $v; return match (strtolower(substr($v, -1))) { 'g' => $n * 1073741824, 'm' => $n * 1048576, 'k' => $n * 1024, default => $n }; };
    $up = $toBytes(ini_get('upload_max_filesize'));
    $post = $toBytes(ini_get('post_max_size'));
    $up < 50 * 1048576 || $post < 50 * 1048576
        ? $note('PHP (command line) allows uploads of '.ini_get('upload_max_filesize').' / posts of '.ini_get('post_max_size'), 'In the PHP-FPM php.ini set upload_max_filesize=64M and post_max_size=64M; in nginx set client_max_body_size 64m; restart both. (The website uses PHP-FPM, whose limits can differ from this check.)')
        : $ok('PHP upload limits look big enough');

    $this->info('Live updates and background work');
    $rt = \App\Support\Realtime::clientSettings();
    if (! $rt) {
        $note('Live updates (Reverb) are off: pages fall back to checking every few seconds', 'php artisan sos:realtime-setup, run reverb:start under Supervisor, and proxy it through nginx (docs/deployment.md)');
    } else {
        $ok("Live updates: clients connect to {$rt['scheme']}://".($rt['host'] ?? '(the site address)').":{$rt['port']}");
        if (str_starts_with($url, 'https://') && $rt['scheme'] !== 'https') {
            $fail('The site is https but live updates use plain ws:// — browsers block that, so calls ring late and chats update slowly',
                'Set REVERB_PUBLIC_HOST=your-domain, REVERB_PUBLIC_PORT=443, REVERB_PUBLIC_SCHEME=https and proxy /app to Reverb in nginx (docs/deployment.md)');
        }
        $host = (string) config('broadcasting.connections.reverb.options.host') ?: '127.0.0.1';
        $port = (int) (config('reverb.servers.reverb.port') ?? env('REVERB_SERVER_PORT', 8080));
        $sock = @fsockopen(in_array($host, ['0.0.0.0', ''], true) ? '127.0.0.1' : '127.0.0.1', $port, $errno, $errstr, 2);
        $sock ? $ok("Reverb is running on port {$port}") : $fail("Nothing is listening on port {$port}: Reverb isn't running", 'Run "php artisan reverb:start" under Supervisor/systemd (docs/deployment.md)');
        if ($sock) { fclose($sock); }
    }
    $queue = config('queue.default');
    if ($queue === 'sync') {
        $ok('Background jobs run straight away (QUEUE_CONNECTION=sync)');
    } else {
        try {
            $waiting = $queue === 'database' ? \Illuminate\Support\Facades\DB::table(config('queue.connections.database.table', 'jobs'))->where('created_at', '<', now()->subMinutes(2)->timestamp)->count() : 0;
            $waiting > 0 ? $fail("{$waiting} background job(s) have waited over 2 minutes: no queue worker is running", 'Run "php artisan queue:work" under Supervisor/systemd (docs/deployment.md)')
                : $ok("Background jobs ({$queue}) are not piling up");
            $failed = \Illuminate\Support\Facades\Schema::hasTable('failed_jobs') ? \Illuminate\Support\Facades\DB::table('failed_jobs')->where('failed_at', '>', now()->subDay())->count() : 0;
            $failed ? $note("{$failed} background job(s) failed in the last day", 'php artisan queue:failed (to see why), then php artisan queue:retry all') : null;
        } catch (\Throwable $e) {
            $note('Could not check the queue: '.$e->getMessage(), 'php artisan migrate --force');
        }
    }

    $this->info('Calls');
    $c = config('sos.calls');
    if (($c['turn_host'] && $c['turn_secret']) || ($c['turn_urls'] && $c['turn_username'])) {
        $ok('A relay (TURN) server is set: calls can connect between different networks');
        if ($c['turn_host']) {
            $s = @fsockopen($c['turn_host'], 3478, $e1, $e2, 3);
            $s ? $ok("TURN server answers on {$c['turn_host']}:3478") : $fail("TURN server {$c['turn_host']}:3478 can't be reached", 'Start coturn and open ports 3478 (TCP+UDP) and 49152-65535/UDP in the firewall (docs/calls.md)');
            if ($s) { fclose($s); }
        }
    } else {
        $fail('No relay (TURN) server: calls only connect when both people are on the same network',
            'Set up coturn (docs/calls.md) and set TURN_HOST + TURN_SECRET, or use a hosted TURN service with TURN_URLS, TURN_USERNAME, TURN_PASSWORD');
    }

    $this->info('Media');
    \App\Services\Media\VideoCompressor::available() ? $ok('ffmpeg is installed: videos sent from the website are made smaller')
        : $note('ffmpeg is not installed: videos sent from the website keep their full size (the phone app still compresses its own)', 'sudo apt install ffmpeg   (or set FFMPEG_PATH)');

    $this->info('Billing');
    try {
        $plans = \App\Models\Plan::where('is_active', true)->get();
        $plans->isEmpty() ? $fail('No plans', 'php artisan migrate --force') : $ok($plans->count().' plans; subscriptions are '.(\App\Services\Billing\Billing::enforced() ? 'enforced' : 'tracked but not enforced'));
        \App\Services\Billing\Billing::enforced() && $plans->every(fn ($p) => $p->price_monthly === 0 && $p->price_yearly === 0)
            ? $note('Subscriptions are enforced but every plan is free', 'Set prices under Platform > Plans') : null;
        \App\Support\PlatformSettings::get('payments.online') && ! \App\Services\Billing\Paystack::configured()
            ? $fail('Online payment is on but Paystack keys are missing', 'Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY to .env, then php artisan config:cache') : null;
    } catch (\Throwable $e) {
        $note('Could not check billing: '.$e->getMessage(), 'php artisan migrate --force');
    }

    $this->info('Face capture');
    is_file(public_path('mediapipe/face_landmarker.task')) ? $ok('Face model is on this server') : $note('Face model not downloaded (it loads from Google instead, slower)', 'php artisan sos:face-model');
    is_dir(public_path('mediapipe/wasm')) ? $ok('Face tracking files are present') : $fail('public/mediapipe/wasm is missing', 'Deploy again (the folder is part of the code)');

    $this->newLine();
    $bad ? $this->error("{$bad} problem(s) to fix".($warn ? ", {$warn} to look at" : '')) : ($warn ? $this->warn("No blocking problems; {$warn} to look at") : $this->info('Everything looks right.'));

    return $bad ? 1 : 0;
})->purpose('Check the server set-up (database, uploads, live updates, calls, face capture) and say how to fix problems');

Artisan::command('sos:billing', function () {
    // Trials and paid periods that ended, overdue subscriptions past their grace period, free plans renewing.
    $changed = \App\Services\Billing\Billing::tick();
    $changed ? array_map(fn ($l) => $this->line($l), $changed) : $this->info('No subscription changes.');
})->purpose('Move subscriptions along: trial and period ends, renewal invoices, grace periods');
