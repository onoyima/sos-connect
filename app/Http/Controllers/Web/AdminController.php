<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\DataRequest;
use App\Models\Institution;
use App\Models\InstitutionConnector;
use App\Models\MessageReport;
use App\Services\Connector\ConnectorClient;
use App\Support\Access;
use App\Support\Modules;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/** Institution settings, connector, feature switches, reports and audit. Limited to the admin's own institution. */
class AdminController extends Controller
{
    public function settings(Request $request): Response
    {
        $i = $request->user()->institution;

        return Inertia::render('Admin/Settings', [
            'profile' => $i->only(['name', 'short_code', 'country', 'status', 'security_phone', 'contact_name', 'contact_email', 'dpo_name', 'dpo_email', 'email_domains', 'dpa_version', 'dpa_accepted_at']),
            'settings' => array_merge(Institution::DEFAULT_SETTINGS, $i->settings ?? []),
            'connector' => $i->connector ? $i->connector->only(['base_url', 'key_id', 'query_set', 'last_tested_at', 'last_test_ok', 'last_error'])
                + ['db' => array_diff_key($i->connector->db_settings ?? [], ['password' => true]) + ['has_password' => ! empty($i->connector->db_settings['password'])]] : null,
            'directAvailable' => (bool) config('sos.connector.allow_direct'),
            'querySets' => config('sos.connector.query_sets'),
            'signIn' => ['email_domains' => $i->email_domains ?? [], 'login_patterns' => $i->settings['login_patterns'] ?? [],
                'auto_sync' => (bool) ($i->settings['auto_sync'] ?? true), 'synced_at' => $i->settings['structure_synced_at'] ?? null],
            'retentionDefaults' => config('sos.retention'),
            'can' => ['settings' => Access::can($request->user(), 'settings.edit'), 'connector' => Access::can($request->user(), 'connector.edit')],
        ]);
    }

    public function saveSettings(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $data = $request->validate([
            'security_phone' => 'nullable|string|max:30',
            'settings.allow_foreign_relay' => 'boolean',
            'settings.student_group_creation' => 'boolean',
            'settings.minor_consent_at_admission' => 'boolean',
            'settings.status_audience_max' => 'in:contacts,department,institution',
            'settings.retention_overrides' => 'array',
            'settings.retention_overrides.*' => 'nullable|integer|min:1',
        ]);
        $i->update(['security_phone' => $data['security_phone'] ?? $i->security_phone,
            'settings' => array_merge($i->settings ?? [], $data['settings'] ?? [])]);
        AuditLog::record('institution.settings_updated', $i, ['keys' => array_keys($data['settings'] ?? [])]
            + (array_key_exists('minor_consent_at_admission', $data['settings'] ?? []) ? ['minor_consent_at_admission' => (bool) $data['settings']['minor_consent_at_admission']] : []));
        \App\Support\Access::forget();

        return back()->with('status', 'Settings saved.');
    }

    /** The institution's own details: name, short name, contacts. Changing the short name renames the automatic groups. */
    public function saveDetails(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $data = $request->validate([
            'name' => 'required|string|min:3|max:190',
            'short_code' => ['required', 'string', 'min:2', 'max:12', 'regex:/^[A-Za-z0-9]+$/', \Illuminate\Validation\Rule::unique('institutions', 'short_code')->ignore($i->id)],
            'contact_name' => 'required|string|max:120',
            'contact_email' => 'required|email|max:190',
            'dpo_name' => 'nullable|string|max:120',
            'dpo_email' => 'nullable|email|max:190',
        ], ['short_code.regex' => 'Use letters and numbers only, for example FUSTE.', 'short_code.unique' => 'Another institution already uses this short name.']);
        $data['short_code'] = strtoupper($data['short_code']);

        $before = $i->only(array_keys($data));
        $i->update($data);
        $changed = array_keys(array_diff_assoc(array_map('strval', $data), array_map('strval', $before)));
        AuditLog::record('institution.details_updated', $i, ['fields' => $changed]);

        // The automatic groups ("All FUSTE Students"...) carry the short name: refresh them in the background.
        if (in_array('short_code', $changed, true)) {
            $id = $i->id;
            dispatch(function () use ($id) {
                app(\App\Services\Groups\AutoGroupSync::class)->buildAll(\App\Models\Institution::findOrFail($id));
            })->afterResponse();
        }

        return back()->with('status', $changed ? 'Institution details saved.' : 'Nothing changed.');
    }

    /**
     * How this app reaches the institution's records: directly (database details, stored encrypted) or through a
     * separate connector (address; a shared secret is generated here and shown ONCE).
     */
    public function saveConnector(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $direct = $request->input('base_url') === ConnectorClient::DIRECT;
        abort_if($direct && ! config('sos.connector.allow_direct'), 422, 'Direct database access is switched off on this server.');
        $rule = $direct ? 'required|string' : (app()->isLocal() ? 'required|url|max:255' : 'required|url|starts_with:https://|max:255');
        $data = $request->validate(['base_url' => $rule, 'rotate_secret' => 'boolean'] + ($direct ? [
            'query_set' => ['required', 'in:'.implode(',', array_keys(config('sos.connector.query_sets')))],
            'db.driver' => 'required|in:mysql,mariadb'.(app()->environment('production') ? '' : ',sqlite'),
            'db.host' => 'nullable|string|max:190', 'db.port' => 'nullable|integer|min:1|max:65535',
            'db.database' => 'required|string|max:190', 'db.username' => 'nullable|string|max:120', 'db.password' => 'nullable|string|max:200',
        ] : []));

        $connector = $i->connector ?? new InstitutionConnector(['institution_id' => $i->id, 'key_id' => 'k_'.Str::lower(Str::random(12))]);
        if ($direct) {
            $db = $data['db'];
            $db['password'] = ($db['password'] ?? '') !== '' ? $db['password'] : ($connector->db_settings['password'] ?? null); // blank = keep
            $connector->fill(['db_settings' => $db, 'query_set' => $data['query_set']]);
        }
        $newSecret = null;
        if (! $connector->exists || ($data['rotate_secret'] ?? false)) {
            $newSecret = Str::random(64);
            $connector->secret = $newSecret;
        }
        $connector->base_url = rtrim($data['base_url'], '/');
        $connector->save();
        AuditLog::record('connector.saved', $connector, ['rotated' => (bool) $newSecret]);

        $i->setRelation('connector', $connector);
        if ($direct) {
            return $this->testConnector($request); // check straight away
        }

        return back()->with('status', $newSecret
            ? "Connector saved. Put these in the connector's config now — the secret will not be shown again. KEY_ID={$connector->key_id} SECRET={$newSecret}"
            : 'Connector address saved.');
    }

    /** How the sign-in page recognises this institution's members, and whether records sync nightly. */
    public function saveSignIn(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $data = $request->validate([
            'email_domains' => 'array|max:10', 'email_domains.*' => ['string', 'max:120', 'regex:/^@?[a-z0-9.-]+\.[a-z]{2,}$/i'],
            'login_patterns' => 'array|max:10', 'login_patterns.*' => 'string|max:60',
            'auto_sync' => 'boolean',
        ]);
        $domains = array_values(array_unique(array_filter(array_map(fn ($d) => ltrim(mb_strtolower(trim($d)), '@'), $data['email_domains'] ?? []))));
        foreach ($domains as $d) {
            abort_if(Institution::where('id', '!=', $i->id)->whereJsonContains('email_domains', $d)->exists(), 422, "{$d} is already used by another institution.");
        }
        $i->update(['email_domains' => $domains, 'settings' => array_merge($i->settings ?? [], [
            'login_patterns' => array_values(array_filter(array_map('trim', $data['login_patterns'] ?? []))),
            'auto_sync' => (bool) ($data['auto_sync'] ?? true),
        ])]);
        AuditLog::record('institution.sign_in_updated', $i);

        return back()->with('status', 'Sign-in settings saved.');
    }

    public function testConnector(Request $request): RedirectResponse
    {
        $connector = $request->user()->institution->connector;
        abort_unless($connector, 422, 'Save the connector first.');
        $missing = [];
        try {
            $health = (new ConnectorClient($connector))->health();
            $ok = ($health['ok'] ?? false) === true;
            $missing = array_slice((array) ($health['missing'] ?? []), 0, 8);
            $connector->update(['last_tested_at' => now(), 'last_test_ok' => $ok, 'last_error' => $ok ? null : 'Unexpected response']);
        } catch (Throwable $e) {
            $connector->update(['last_tested_at' => now(), 'last_test_ok' => false, 'last_error' => mb_substr($e->getMessage(), 0, 250)]);
        }

        if (! $connector->last_test_ok) {
            return back()->with('error', 'Records connection test failed. '.$connector->last_error);
        }

        return back()->with('status', 'Records connection works, and sign-in can read your records.'.($missing
            ? ' Your records system doesn\'t have a few details, so these will be left empty: '.implode(', ', $missing).'.'
            : ''));
    }

    public function modules(Request $request): Response
    {
        $i = $request->user()->institution;

        return Inertia::render('Admin/Modules', [
            'modules' => collect(Modules::ALL)->map(fn ($m, $key) => [
                'key' => $key, 'label' => $m['label'], 'description' => $m['description'], 'requires' => $m['requires'] ?? null,
                'saved' => (bool) (($i->settings['modules'] ?? [])[$key] ?? $m['default']), 'enabled' => Modules::enabled($i, $key),
                'in_plan' => Modules::inPlan($i, $key),
            ])->values(),
        ]);
    }

    public function saveModules(Request $request): RedirectResponse
    {
        $i = $request->user()->institution;
        $data = $request->validate(['modules' => 'required|array', 'modules.*' => 'boolean']);
        $clean = array_intersect_key(array_map('boolval', $data['modules']), Modules::ALL);
        $before = ($i->settings ?? [])['modules'] ?? [];
        $i->update(['settings' => array_merge($i->settings ?? [], ['modules' => array_merge($before, $clean)])]);
        Access::forget();
        $changed = array_keys(array_filter($clean, fn ($v, $k) => ($before[$k] ?? Modules::ALL[$k]['default']) !== $v, ARRAY_FILTER_USE_BOTH));
        AuditLog::record('institution.modules_changed', $i, ['changed' => $changed]);

        return back()->with('status', $changed ? 'Features updated. Changes apply to everyone straight away.' : 'Nothing changed.');
    }

    public function reports(Request $request): Response
    {
        $me = $request->user();

        return Inertia::render('Admin/Reports', [
            'reports' => Access::can($me, 'reports.view') ? MessageReport::latest()->limit(100)->get() : [],
            'dataRequests' => Access::can($me, 'data_requests.view')
                ? DataRequest::where('institution_id', $me->institution_id)->with('user:id,name,identifier')->latest()->limit(100)->get() : [],
        ]);
    }

    public function audit(Request $request): Response
    {
        $page = AuditLog::where('institution_id', $request->user()->institution_id)->latest('created_at')->paginate(50)->withQueryString();
        $entries = collect($page->items());
        $actors = \App\Models\User::inInstitution($request->user()->institution_id)->whereIn('id', $entries->pluck('actor_id')->filter()->unique())->pluck('name', 'id');

        return Inertia::render('Admin/Audit', [
            'entries' => $entries->map(fn ($e) => $e->toArray() + ['actor_name' => $e->actor_id ? ($actors[$e->actor_id] ?? 'Former member') : null])->values(),
            'links' => $page->linkCollection(),
            'page' => ['current' => $page->currentPage(), 'last' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }
}
