<?php

namespace Tests\Unit;

use App\Services\Auth\SignIn;
use PHPUnit\Framework\TestCase;

/** The matric / staff number formats an institution sets under Admin > Settings > Sign-in. */
class SignInFormatsTest extends TestCase
{
    public function test_star_matches_anything_and_hash_one_digit(): void
    {
        $this->assertTrue(SignIn::matches('ABC/*/##/####', 'ABC/PHE/24/0142'));
        $this->assertTrue(SignIn::matches('ABC/*/##/####', 'abc/phe/24/0142')); // capitals don't matter
        $this->assertFalse(SignIn::matches('ABC/*/##/####', 'ABC/PHE/24/01X2'));
        $this->assertFalse(SignIn::matches('ABC/*/##/####', 'XYZ/PHE/24/0142'));
        $this->assertTrue(SignIn::matches('STF/####', 'stf/0457'));
    }

    public function test_other_characters_are_taken_literally(): void
    {
        $this->assertTrue(SignIn::matches('A.B-(1)', 'a.b-(1)'));
        $this->assertFalse(SignIn::matches('A.B', 'AxB'));
        $this->assertFalse(SignIn::matches('', 'anything'));
        $this->assertFalse(SignIn::matches('   ', 'anything'));
    }
}
