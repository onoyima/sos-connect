<?php

namespace App\Support;

/**
 * One list of roles for the whole platform. Never compare role strings by hand in controllers:
 * ask Permissions::allows($user, 'permission.name') instead.
 */
enum Role: string
{
    case Student = 'STUDENT';
    case Staff = 'STAFF';
    case Guest = 'GUEST';
    case Security = 'SECURITY';               // campus security / clinic responders: receive every SOS
    case Hod = 'HOD';                          // scoped to their department
    case Dean = 'DEAN';                        // scoped to their faculty
    case Registrar = 'REGISTRAR';
    case Vc = 'VC';
    case InstitutionAdmin = 'INSTITUTION_ADMIN';
    case PlatformAdmin = 'PLATFORM_ADMIN';     // our own staff; has no access to message content

    public function label(): string
    {
        return match ($this) {
            self::Student => 'Student',
            self::Staff => 'Staff',
            self::Guest => 'Guest',
            self::Security => 'Security / responder',
            self::Hod => 'Head of Department',
            self::Dean => 'Dean',
            self::Registrar => 'Registrar',
            self::Vc => 'Vice-Chancellor',
            self::InstitutionAdmin => 'Institution admin',
            self::PlatformAdmin => 'Platform admin',
        };
    }

    /** Roles an institution admin may hand out (they can't create platform admins). */
    public static function assignable(): array
    {
        return array_values(array_filter(self::cases(), fn (self $r) => $r !== self::PlatformAdmin));
    }
}
