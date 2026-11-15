<?php

namespace Tests\Unit;

use App\Http\Controllers\Web\OnboardingController as O;
use PHPUnit\Framework\TestCase;

/** Registering an institution: the contact's email must be on the institution's own domain. */
class OfficialEmailTest extends TestCase
{
    public function test_domain_is_tidied_however_it_was_typed(): void
    {
        foreach (['school.edu', ' School.EDU ', '@school.edu', 'www.school.edu', 'https://www.school.edu/', 'http://school.edu/about', 'registrar@school.edu', 'School .edu'] as $typed) {
            $this->assertSame('school.edu', O::cleanDomain($typed), $typed);
        }
    }

    public function test_email_on_the_domain_or_a_sub_domain_counts(): void
    {
        $this->assertTrue(O::emailOnDomain('registrar@school.edu', 'school.edu'));
        $this->assertTrue(O::emailOnDomain('ict@staff.school.edu', 'school.edu'));
        $this->assertTrue(O::emailOnDomain('ICT@School.edu', 'school.edu'));
        $this->assertFalse(O::emailOnDomain('someone@gmail.com', 'school.edu'));
        $this->assertFalse(O::emailOnDomain('someone@notschool.edu', 'school.edu')); // look-alike domain
        $this->assertFalse(O::emailOnDomain('someone@school.edu.evil.com', 'school.edu'));
    }

    public function test_sub_domains_work_in_either_direction(): void
    {
        $this->assertTrue(O::emailOnDomain('registrar@school.edu.ng', 'portal.school.edu.ng'));
        $this->assertTrue(O::emailOnDomain('ict@staff.school.edu.ng', 'staff.school.edu.ng'));
        $this->assertTrue(O::emailOnDomain('ict@mail.staff.school.ac.uk', 'school.ac.uk'));
        $this->assertSame('school.edu.ng', O::memberDomain('registrar@school.edu.ng', 'portal.school.edu.ng'));
        $this->assertSame('staff.school.edu.ng', O::memberDomain('ict@staff.school.edu.ng', 'staff.school.edu.ng'));
    }

    public function test_public_email_services_never_count(): void
    {
        $this->assertFalse(O::emailOnDomain('someone@gmail.com', 'gmail.com'));
        $this->assertFalse(O::emailOnDomain('someone@gmail.com', 'school.gmail.com'));
        $this->assertFalse(O::emailOnDomain('someone@yahoo.co.uk', 'yahoo.co.uk'));
    }
}
