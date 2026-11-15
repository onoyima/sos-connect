<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\Course;
use App\Models\OrgUnit;
use App\Services\Structure\StructureSync;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StructureSyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_records_import_units_hostels_and_courses_without_duplicates(): void
    {
        $i = $this->makeInstitution();
        $units = [
            ['type' => 'department', 'id' => '12', 'name' => 'Computer Science', 'code' => 'CSC', 'parent_id' => '3'],
            ['type' => 'faculty', 'id' => '3', 'name' => 'Faculty of Natural and Applied Sciences', 'code' => 'NAS', 'parent_id' => null],
            ['type' => 'admin_department', 'id' => '7', 'name' => 'ICT', 'code' => null, 'parent_id' => null],
            ['type' => 'hostel', 'id' => '4', 'name' => 'Hall A', 'code' => null, 'parent_id' => null],
        ];
        $courses = [
            ['id' => '901', 'code' => 'CSC 301', 'title' => 'Data Structures', 'level' => 300, 'semester' => 1, 'department_id' => '12'],
            ['id' => '902', 'code' => 'CSC  301', 'title' => 'Duplicate', 'level' => 300, 'semester' => 1, 'department_id' => '12'],
        ];

        $sync = app(StructureSync::class);
        $n = $sync->import($i, $units, $courses);
        $sync->import($i, $units, $courses); // running again changes nothing

        $this->assertSame(1, $n['skipped']);
        CurrentInstitution::as($i->id, function () {
            $this->assertSame(4, OrgUnit::count());
            $dept = OrgUnit::where('type', 'department')->first();
            $this->assertSame(OrgUnit::where('type', 'faculty')->value('id'), $dept->parent_id);
            $this->assertSame(1, Course::count());
            $this->assertSame($dept->id, Course::first()->org_unit_id);
            $this->assertTrue(Conversation::where('auto_type', 'hostel')->where('name', 'Hall A Residents')->exists());
            $this->assertTrue(Conversation::where('auto_type', 'level')->doesntExist()); // level groups appear when students sign in
        });
    }
}
