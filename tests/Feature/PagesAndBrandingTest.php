<?php

namespace Tests\Feature;

use App\Support\Branding;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Help pages, the admin-only design document, and seasonal icons. */
class PagesAndBrandingTest extends TestCase
{
    use RefreshDatabase;

    public function test_help_for_everyone_design_document_for_admins_and_edits_are_safe(): void
    {
        $i = $this->makeInstitution();
        $student = $this->makeMember($i);
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');

        $this->actingAs($student)->get('/help')->assertOk();
        Sanctum::actingAs($student);
        $slugs = array_column($this->getJson('/api/help')->json('pages'), 'slug');
        $this->assertContains('getting-started', $slugs);
        $this->assertNotContains('admin-guide', $slugs); // admins-only page
        $this->actingAs($student)->get('/admin/design')->assertForbidden();
        $this->actingAs($admin)->get('/admin/design')->assertOk();

        // Admins can change a page; script in the text is never run.
        $this->actingAs($admin)->post('/admin/pages/help/getting-started', ['title' => 'Start here', 'body' => "## Hello\n<script>alert(1)</script>", 'audience' => 'everyone'])
            ->assertRedirect('/help/getting-started');
        Sanctum::actingAs($student);
        $html = $this->getJson('/api/help/getting-started')->assertJsonPath('title', 'Start here')->json('html');
        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('id="hello"', $html);

        $this->actingAs($student)->post('/admin/pages/help/getting-started', ['title' => 'x', 'body' => 'x', 'audience' => 'everyone'])->assertForbidden();
    }

    public function test_seasons_follow_the_calendar(): void
    {
        $on = fn (string $d, string $c = 'NG') => Branding::seasonOn(CarbonImmutable::parse($d), $c)['key'] ?? null;
        $this->assertSame('christmas', $on('2026-12-24'));
        $this->assertSame('new_year', $on('2027-01-01'));
        $this->assertSame('easter', $on('2026-04-05'));
        $this->assertSame('eid_fitr', $on('2026-03-20'));
        $this->assertSame('eid_adha', $on('2026-05-27'));
        $this->assertSame('independence', $on('2026-10-01'));
        $this->assertSame('independence', $on('2026-03-06', 'GH'));
        $this->assertNull($on('2026-08-12'));
    }

    public function test_admin_uploads_an_icon_and_can_switch_seasons_off(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $i = $this->makeInstitution();
        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $png = tempnam(sys_get_temp_dir(), 'ico');
        // 128x128 PNG
        $img = "\x89PNG\r\n\x1a\n".pack('N', 13).'IHDR'.pack('NNCCCCC', 128, 128, 8, 2, 0, 0, 0);
        $img .= pack('N', crc32(substr($img, 12, 17)));
        $raw = str_repeat("\x00".str_repeat("\x1e\x7b\x57", 128), 128);
        $z = gzcompress($raw);
        $img .= pack('N', strlen($z)).'IDAT'.$z.pack('N', crc32('IDAT'.$z)).pack('N', 0).'IEND'.pack('N', crc32('IEND'));
        file_put_contents($png, $img);

        $this->actingAs($admin)->post('/admin/branding', ['icon' => new \Illuminate\Http\UploadedFile($png, 'logo.png', 'image/png', null, true), 'seasonal' => false])
            ->assertSessionHasNoErrors();
        $b = Branding::forClient($i->fresh(), CarbonImmutable::parse('2026-12-24'));
        $this->assertNotNull($b['icon']);
        $this->assertNull($b['season']); // switched off
        $this->get("/brand/{$i->id}/icon")->assertOk()->assertHeader('Content-Type', 'image/png');
    }
}
