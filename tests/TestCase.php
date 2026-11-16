<?php

namespace Tests;

use App\Models\Institution;
use App\Models\InstitutionConnector;
use App\Models\OrgUnit;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Models\User;
use App\Services\Access\RoleManager;
use App\Support\Access;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected string $connectorSecret = 'test-connector-secret-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        $pair = sodium_crypto_sign_keypair();
        config([
            'sos.platform_sign_secret' => base64_encode(sodium_crypto_sign_secretkey($pair)),
            'sos.platform_sign_public' => base64_encode(sodium_crypto_sign_publickey($pair)),
            'broadcasting.default' => 'null',
        ]);
        CurrentInstitution::set(null);
        Access::forget();
        \App\Support\PlatformSettings::forget();
        \App\Services\Billing\Billing::forget();
    }

    protected function makeInstitution(string $code = 'ABC'): Institution
    {
        $i = Institution::create(['name' => "University {$code}", 'short_code' => $code, 'country' => 'NG', 'status' => 'active',
            'contact_name' => 'ICT', 'contact_email' => 'ict@'.strtolower($code).'.school.test', 'settings' => Institution::DEFAULT_SETTINGS]);
        InstitutionConnector::create(['institution_id' => $i->id, 'base_url' => 'https://connector.'.strtolower($code).'.test', 'key_id' => 'k1', 'secret' => $this->connectorSecret]);
        app(RoleManager::class)->installDefaults($i);

        return $i;
    }

    protected function makeMember(Institution $i, array $attrs = []): User
    {
        static $n = 0;
        $n++;

        return User::create(array_merge(['institution_id' => $i->id, 'external_id' => "ext-$n", 'member_type' => 'student',
            'name' => "Member $n", 'email' => "m$n@test", 'status' => 'active',
            'policy_version' => config('sos.legal.policy_version')], $attrs));
    }

    /** Gives a starting role (by slug), optionally over one area. */
    protected function giveRole(User $user, string $slug, ?int $unitId = null): void
    {
        CurrentInstitution::as($user->institution_id, fn () => RoleAssignment::create([
            'user_id' => $user->id, 'role_id' => Role::where('slug', $slug)->value('id'), 'org_unit_id' => $unitId, 'source' => 'manual',
        ]));
        Access::forget();
    }

    protected function makeUnit(Institution $i, string $type, string $name, ?int $parentId = null): OrgUnit
    {
        return CurrentInstitution::as($i->id, fn () => OrgUnit::create(['type' => $type, 'external_id' => strtolower(str_replace(' ', '-', $name)),
            'name' => $name, 'code' => strtoupper(substr($name, 0, 3)), 'parent_id' => $parentId]));
    }

    /** Builds a correctly signed connector response, the way connector/public/index.php does. */
    protected function connectorResponse(array $body): \GuzzleHttp\Promise\PromiseInterface
    {
        $raw = json_encode($body);
        $ts = (string) time();

        return \Illuminate\Support\Facades\Http::response($raw, 200, [
            'X-SOS-Timestamp' => $ts,
            'X-SOS-Signature' => hash_hmac('sha256', $ts."\n".hash('sha256', $raw), $this->connectorSecret),
        ]);
    }
}
