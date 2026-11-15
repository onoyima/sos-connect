<?php

namespace App\Services\Auth;

use App\Models\Institution;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * One sign-in box for everyone: email, matric number or staff number, plus password.
 *
 * There is no public list or search of institutions, and every failure gives the same message, so nobody can
 * find out from the sign-in page whether a school uses this service. The school is worked out on the server:
 *   1. platform operators and local accounts (institution admins, parents) by their email;
 *   2. otherwise the school whose email domains or ID formats (Admin > Settings > Sign-in) match what was typed;
 *   3. if the service has only one school, that school.
 * The password only ever goes to a school the identifier matches.
 */
class SignIn
{
    public const FAILED = "Those details didn't work. Use the same email or number and password as your school portal.";

    public function __construct(private readonly InstitutionLogin $login) {}

    /** @return array{ok:bool, user?:User, error?:string} */
    public function attempt(string $identifier, string $password): array
    {
        $id = trim($identifier);
        if ($id === '' || $password === '') {
            return ['ok' => false, 'error' => self::FAILED];
        }
        $email = str_contains($id, '@') ? mb_strtolower($id) : null;

        // 1. Platform operators.
        if ($email && ($op = User::whereNull('institution_id')->where('is_platform_admin', true)->where('email', $email)->first())) {
            return $op->isActive() && Hash::check($password, (string) $op->password) ? ['ok' => true, 'user' => $op] : $this->failed();
        }

        // 2. Local accounts (institution admins, invited parents) in any school.
        if ($email) {
            $schools = User::whereNotNull('institution_id')->where('auth_source', 'local')->where('email', $email)->pluck('institution_id');
            foreach (Institution::with('connector')->whereIn('id', $schools)->get() as $school) {
                $r = $this->login->attempt($school, $id, $password);
                if ($r['ok'] || $r['error'] !== InstitutionLogin::INVALID) {
                    return $this->clean($r);
                }
            }
        }

        // 3. Members, checked by their school's own records.
        foreach ($this->schoolsFor($id, $email) as $school) {
            $r = $this->login->attempt($school, $id, $password);
            if ($r['ok'] || $r['error'] !== InstitutionLogin::INVALID) {
                return $this->clean($r);
            }
        }

        return $this->failed();
    }

    /** @return iterable<Institution> */
    private function schoolsFor(string $id, ?string $email): iterable
    {
        $schools = Institution::with('connector')->where('status', 'active')->whereHas('connector')->get();
        $domain = $email ? substr(strrchr($email, '@'), 1) : null;

        $matches = $schools->filter(function (Institution $i) use ($id, $domain) {
            if ($domain) {
                foreach ($i->email_domains ?? [] as $d) {
                    $d = mb_strtolower(ltrim((string) $d, '@'));
                    if ($d !== '' && ($domain === $d || str_ends_with($domain, '.'.$d))) {
                        return true;
                    }
                }
            }
            foreach (($i->settings['login_patterns'] ?? []) as $pattern) {
                if (self::matches((string) $pattern, $id)) {
                    return true;
                }
            }

            return false;
        });

        if ($matches->isEmpty() && $schools->count() === 1) {
            return $schools; // a service run for one school
        }

        return $matches->take(3);
    }

    /** ID formats: * = anything, # = one digit. "ABC/*" or "##/####". Case doesn't matter. */
    public static function matches(string $pattern, string $value): bool
    {
        $pattern = trim($pattern);
        if ($pattern === '') {
            return false;
        }
        $regex = str_replace(['\*', '\#'], ['.*', '\d'], preg_quote($pattern, '/'));

        return (bool) preg_match('/^'.$regex.'$/i', $value);
    }

    private function clean(array $r): array
    {
        return $r['ok'] ? $r : ['ok' => false, 'error' => $r['error']];
    }

    private function failed(): array
    {
        password_verify('x', '$2y$10$81PFGCsBslX9BrsqXFhRneBd3q7X9z0VohUHyZmGutfCbVcQ/.64y'); // similar timing either way

        return ['ok' => false, 'error' => self::FAILED];
    }
}
