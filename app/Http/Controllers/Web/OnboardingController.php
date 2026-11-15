<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Institution;
use App\Models\Role;
use App\Models\RoleAssignment;
use App\Models\User;
use App\Services\Access\RoleManager;
use App\Support\CurrentInstitution;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * An institution signs up: an authorised officer accepts the Data Processing Agreement on the
 * institution's behalf and gets a local admin account. The institution stays "pending" until our team
 * verifies it (official email domain + letter of authority) and its connector passes a test.
 */
class OnboardingController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('Onboarding/Register', ['dpaVersion' => config('sos.legal.policy_version')]);
    }

    /** "https://www.School.edu/", "@school.edu" and " school.edu " all mean school.edu. */
    public static function cleanDomain(?string $domain): string
    {
        $d = mb_strtolower(trim((string) $domain));
        $d = preg_replace('#^[a-z]+://#', '', $d);
        if (str_contains($d, '@')) {
            $d = substr(strrchr($d, '@'), 1); // a whole email address was typed: keep the part after @
        }
        $d = preg_replace('/\s+/', '', $d);
        $d = preg_replace('#^www\.#', '', $d);

        return rtrim(explode('/', $d)[0], '.');
    }

    /** Public email services: an address on one of these never proves someone works at an institution. */
    public const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com',
        'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com'];

    /**
     * True if the email and the domain belong together, at any level: the same domain, the email on a sub-domain
     * (you@staff.school.edu for school.edu) or the domain entered being a sub-domain of the email's
     * (you@school.edu for portal.school.edu). Public mail services never count.
     */
    public static function emailOnDomain(string $email, string $domain): bool
    {
        $host = mb_strtolower(trim((string) substr(strrchr($email, '@') ?: '', 1)));
        if ($domain === '' || $host === '' || self::isFreeMail($host) || self::isFreeMail($domain)) {
            return false;
        }

        return $host === $domain || str_ends_with($host, '.'.$domain) || str_ends_with($domain, '.'.$host);
    }

    public static function isFreeMail(string $domain): bool
    {
        foreach (self::FREE_MAIL as $free) {
            if ($domain === $free || str_ends_with($domain, '.'.$free)) {
                return true;
            }
        }

        return false;
    }

    /** The domain to recognise members by: the broader of the two (school.edu covers staff.school.edu too). */
    public static function memberDomain(string $email, string $domain): string
    {
        $host = mb_strtolower(substr(strrchr($email, '@') ?: '', 1));

        return strlen($host) < strlen($domain) && str_ends_with($domain, '.'.$host) ? $host : $domain;
    }

    public function store(Request $request): RedirectResponse
    {
        // At most 3 institutions registered from one network per hour. Fixing mistakes in the form doesn't count.
        $okKey = 'register-ok:'.$request->ip();
        if (\Illuminate\Support\Facades\RateLimiter::tooManyAttempts($okKey, 3)) {
            return back()->withInput($request->except('password', 'password_confirmation'))->withErrors([
                'name' => 'Several institutions were registered from this network recently. Try again in '.ceil(\Illuminate\Support\Facades\RateLimiter::availableIn($okKey) / 60).' minutes.',
            ]);
        }
        $email = mb_strtolower(trim((string) $request->input('contact_email')));
        $domain = self::cleanDomain($request->input('email_domain'));
        if ($domain === '' && str_contains($email, '@')) {
            $domain = self::cleanDomain($email); // left empty: use the domain of the contact's own email
        }
        $request->merge(['email_domain' => $domain, 'contact_email' => $email]);
        $data = $request->validate([
            'name' => 'required|string|max:160|unique:institutions,name',
            'short_code' => 'required|alpha_num|max:20|unique:institutions,short_code',
            'country' => 'required|string|size:2',
            // Any domain or sub-domain: school.edu, staff.school.edu.ng, portal.dept.school.ac.uk ...
            'email_domain' => ['required', 'string', 'max:120', 'regex:/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i'],
            'contact_name' => 'required|string|max:120',
            'contact_title' => 'required|string|max:120',
            'contact_email' => 'required|email|max:190',
            'contact_phone' => 'required|string|max:30',
            'security_phone' => 'nullable|string|max:30',
            'dpo_name' => 'required|string|max:120',
            'dpo_email' => 'required|email|max:190',
            'password' => 'required|string|min:12|confirmed',
            'accept_dpa' => 'accepted',
            'accept_terms' => 'accepted',
            'confirm_authority' => 'accepted',
        ], [
            'email_domain.regex' => 'Enter the domain or sub-domain only, like school.edu or staff.school.edu (the part after @ in your work email).',
            'email_domain.required' => 'Enter your institution\'s email domain, like school.edu.',
        ]);

        if (! self::emailOnDomain($data['contact_email'], $data['email_domain'])) {
            $host = substr(strrchr($data['contact_email'], '@') ?: '', 1);

            return back()->withInput($request->except('password', 'password_confirmation'))->withErrors([
                'contact_email' => self::isFreeMail($host)
                    ? "\"{$host}\" is a public email service. Use your email address at the institution."
                    : "Your email is on \"{$host}\", which isn't part of \"{$data['email_domain']}\". Use an email address on your institution's domain or one of its sub-domains.",
            ]);
        }
        $data['email_domain'] = self::memberDomain($data['contact_email'], $data['email_domain']);

        DB::transaction(function () use ($data, $request) {
            $institution = Institution::create([
                'name' => $data['name'], 'short_code' => strtoupper($data['short_code']), 'country' => strtoupper($data['country']),
                'email_domains' => [mb_strtolower($data['email_domain'])], 'status' => 'pending',
                'contact_name' => $data['contact_name'], 'contact_email' => mb_strtolower($data['contact_email']), 'contact_phone' => $data['contact_phone'],
                'security_phone' => $data['security_phone'] ?? null, 'dpo_name' => $data['dpo_name'], 'dpo_email' => $data['dpo_email'],
                'settings' => Institution::DEFAULT_SETTINGS,
                'dpa_accepted_at' => now(), 'dpa_accepted_by' => $data['contact_name'].' ('.$data['contact_title'].')',
                'dpa_version' => config('sos.legal.policy_version'),
            ]);

            $admin = User::create([
                'institution_id' => $institution->id, 'auth_source' => 'local', 'member_type' => 'admin',
                'name' => $data['contact_name'], 'email' => mb_strtolower($data['contact_email']), 'password' => $data['password'],
                'title' => 'Super admin', 'status' => 'active',
                'policy_version' => config('sos.legal.policy_version'), 'policy_accepted_at' => now(),
            ]);

            // The starting roles, and the person who registered becomes the institution's first super admin.
            $roles = app(RoleManager::class);
            $roles->installDefaults($institution);
            CurrentInstitution::as($institution->id, fn () => RoleAssignment::create([
                'user_id' => $admin->id, 'role_id' => Role::where('slug', 'super_admin')->value('id'), 'source' => 'manual',
                'note' => 'Registered the institution',
            ]));

            AuditLog::record('institution.registered', $institution, ['ip' => $request->ip(), 'dpa_version' => config('sos.legal.policy_version')], $institution->id);
        });

        \Illuminate\Support\Facades\RateLimiter::hit($okKey, 3600);

        return redirect()->route('login')->with('status', 'Registration received. We will verify your institution and email you within 3 working days. Meanwhile, sign in and connect your records under Settings.');
    }
}
