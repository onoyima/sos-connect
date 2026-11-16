<?php

namespace App\Services\Parents;

use App\Models\GuardianLink;
use App\Models\Institution;
use App\Models\User;
use App\Support\CurrentInstitution;
use App\Support\Modules;

/**
 * Parents and guardians listed in the student's records (student_contacts) become parent accounts linked to the
 * student, without a password. They can't sign in until staff send them an invitation from Admin > Parents and
 * they choose a password. Only runs when the Parents feature is switched on.
 */
class GuardianImport
{
    public function sync(Institution $institution, User $student, array $guardians): void
    {
        if ($student->member_type !== 'student' || ! $guardians || ! Modules::enabled($institution, 'parents')) {
            return;
        }

        CurrentInstitution::as($institution->id, function () use ($institution, $student, $guardians) {
            foreach ($guardians as $g) {
                $email = $g['email'] ?: null;
                // Find the same parent across siblings: by email, else by phone.
                $parent = User::inInstitution($institution->id)->where('member_type', 'parent')
                    ->where(fn ($q) => $email ? $q->where('email', $email) : $q->where('phone_index', \App\Support\Sealed::phoneIndex($g['phone'])))->first();
                if (! $parent && $email && User::inInstitution($institution->id)->where('email', $email)->exists()) {
                    continue; // that email belongs to a student or staff member; don't merge accounts
                }
                $parent ??= User::create([
                    'institution_id' => $institution->id, 'auth_source' => 'local', 'member_type' => 'parent', 'status' => 'active',
                    'name' => $g['name'], 'email' => $email, 'phone' => $g['phone'] ?: null,
                    'external_id' => 'guardian-'.substr(hash('sha256', $institution->id.'|'.($email ?: $g['phone'])), 0, 24),
                ]);
                GuardianLink::firstOrCreate(['parent_id' => $parent->id, 'student_id' => $student->id], ['relationship' => $g['relationship']]);
            }
        });
    }
}
