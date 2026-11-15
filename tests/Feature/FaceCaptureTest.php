<?php

namespace Tests\Feature;

use App\Models\FaceCapture;
use App\Models\FaceEnrollment;
use App\Models\Institution;
use App\Models\InstitutionConnector;
use App\Services\Faces\FaceStore;
use App\Support\CurrentInstitution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Guided face capture: switch, consent, encrypted photos, live checks, under-18s, and sending to the school. */
class FaceCaptureTest extends TestCase
{
    use RefreshDatabase;

    private const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAGQASwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC9RRRXKdoUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//9k=';

    private function photo(string $pose): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'face');
        file_put_contents($path, base64_decode(self::JPEG));

        return new UploadedFile($path, "{$pose}.jpg", 'image/jpeg', null, true);
    }

    private function switchOn(Institution $i, bool $required = false): void
    {
        $i->update(['settings' => array_merge($i->settings ?? [], ['modules' => ['face_capture' => true, 'face_capture_required' => $required]])]);
    }

    /** Runs a whole capture through the API; returns the enrollment uuid. */
    private function captureAll(string $base = '/api/face'): string
    {
        $uuid = $this->postJson("{$base}/start", ['consent' => true])->assertCreated()->json('uuid');
        foreach (array_keys(FaceStore::POSES) as $pose) {
            $this->post("{$base}/{$uuid}/captures", ['pose' => $pose, 'image' => $this->photo($pose),
                'metrics' => json_encode(['yaw' => 1, 'sharpness' => 90, 'brightness' => 130, 'face_width' => 320]),
                'landmarks' => json_encode([[0.5, 0.5, 0.01], [0.4, 0.4, 0]])], ['Accept' => 'application/json'])->assertCreated();
        }

        return $uuid;
    }

    public function test_switched_off_by_default_and_needs_consent(): void
    {
        Storage::fake('local');
        $i = $this->makeInstitution();
        $ada = $this->makeMember($i);
        Sanctum::actingAs($ada);

        $this->getJson('/api/face')->assertJsonPath('enabled', false);
        $this->postJson('/api/face/start', ['consent' => true])->assertForbidden();

        $this->switchOn($i);
        $ada->unsetRelation('institution'); // the test reuses one user object; a real request loads the institution afresh
        $this->postJson('/api/face/start', [])->assertStatus(422);
        $this->postJson('/api/face/start', ['consent' => true])->assertCreated();
    }

    public function test_photos_are_encrypted_and_a_capture_needs_every_pose_and_the_live_checks(): void
    {
        Storage::fake('local');
        $i = $this->makeInstitution();
        $this->switchOn($i, required: true);
        $ada = $this->makeMember($i);
        Sanctum::actingAs($ada);

        $uuid = $this->captureAll();
        $this->postJson("/api/face/{$uuid}/complete", ['liveness' => ['blinks' => 0, 'mouth' => true, 'turns' => true]])->assertStatus(422);
        $this->postJson("/api/face/{$uuid}/complete", ['liveness' => ['blinks' => 2, 'mouth' => true, 'turns' => true, 'nods' => true, 'seconds' => 50]])->assertOk();

        $c = CurrentInstitution::as($i->id, fn () => FaceCapture::where('pose', 'front')->first());
        $raw = base64_decode(self::JPEG);
        $this->assertNotSame($raw, Storage::disk('local')->get($c->path)); // never stored as a plain photo
        $this->assertSame($raw, $this->get("/api/face/captures/{$c->id}/image")->getContent());
        $this->getJson('/api/me')->assertJsonPath('user.face.done', true)->assertJsonPath('user.face.required', true);

        // Capturing again replaces the old photos.
        $uuid2 = $this->captureAll();
        $this->postJson("/api/face/{$uuid2}/complete", ['liveness' => ['blinks' => 2, 'mouth' => true, 'turns' => true]])->assertOk();
        $this->assertFalse(Storage::disk('local')->exists($c->path));
        $this->assertSame(1, CurrentInstitution::as($i->id, fn () => FaceEnrollment::where('status', 'complete')->count()));

        // Someone else can't see my photos.
        Sanctum::actingAs($this->makeMember($i));
        $this->get("/api/face/captures/{$c->id}/image", ['Accept' => 'application/json'])->assertNotFound();
    }

    public function test_under_18s_need_guardian_consent(): void
    {
        Storage::fake('local');
        $i = $this->makeInstitution();
        $this->switchOn($i);
        Sanctum::actingAs($this->makeMember($i, ['is_minor' => true]));

        $this->getJson('/api/face')->assertJsonPath('blocked', fn ($v) => str_contains((string) $v, 'under 18'));
        $this->postJson('/api/face/start', ['consent' => true])->assertForbidden();
    }

    public function test_the_phone_app_captures_with_a_ticket(): void
    {
        Storage::fake('local');
        $i = $this->makeInstitution();
        $this->switchOn($i);
        Sanctum::actingAs($this->makeMember($i));
        $url = $this->postJson('/api/face/ticket')->assertOk()->json('url');
        $ticket = basename($url);

        $this->app['auth']->forgetGuards();
        $this->getJson("/api/face/t/{$ticket}")->assertOk()->assertJsonPath('enabled', true);
        $uuid = $this->captureAll("/api/face/t/{$ticket}");
        $this->postJson("/api/face/t/{$ticket}/{$uuid}/complete", ['liveness' => ['blinks' => 2, 'mouth' => true, 'turns' => true]])->assertOk();
        $this->assertSame('phone', CurrentInstitution::as($i->id, fn () => FaceEnrollment::first()->device));

        $this->getJson('/api/face/t/'.str_repeat('x', 48))->assertStatus(401);
    }

    public function test_admin_sends_faces_to_the_school_database(): void
    {
        Storage::fake('local');
        $i = $this->makeInstitution();
        $this->switchOn($i);
        $ada = $this->makeMember($i, ['identifier' => 'VUG/CSC/22/1001', 'name' => 'Ada Obi']);
        Sanctum::actingAs($ada);
        $uuid = $this->captureAll();
        $this->postJson("/api/face/{$uuid}/complete", ['liveness' => ['blinks' => 2, 'mouth' => true, 'turns' => true]])->assertOk();

        $school = tempnam(sys_get_temp_dir(), 'school').'.sqlite';
        touch($school);
        InstitutionConnector::where('institution_id', $i->id)->first()
            ->forceFill(['face_db_settings' => ['driver' => 'sqlite', 'database' => $school, 'prefix' => 'sos_']])->save();

        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $this->actingAs($admin)->get('/admin/faces')->assertOk();
        $this->actingAs($admin)->post('/admin/faces/export', ['kind' => 'database', 'scope' => 'new'])->assertSessionHasNoErrors();

        $pdo = new \PDO('sqlite:'.$school);
        $this->assertSame('VUG/CSC/22/1001', $pdo->query('SELECT id_number FROM sos_face_people')->fetchColumn());
        $this->assertSame(7, (int) $pdo->query('SELECT COUNT(*) FROM sos_face_images')->fetchColumn());
        $this->assertSame(base64_decode(self::JPEG), $pdo->query("SELECT image FROM sos_face_images WHERE pose = 'front'")->fetchColumn());
        $this->assertNotNull(CurrentInstitution::as($i->id, fn () => FaceEnrollment::first()->exported_db_at));

        // A student can't reach the admin page.
        $this->actingAs($ada)->get('/admin/faces')->assertForbidden();
    }

    public function test_admin_downloads_an_encrypted_file(): void
    {
        if (! class_exists(\ZipArchive::class) || ! method_exists(\ZipArchive::class, 'setEncryptionName')) {
            $this->markTestSkipped('PHP zip extension with encryption is not available.');
        }
        Storage::fake('local');
        $i = $this->makeInstitution();
        $this->switchOn($i);
        Sanctum::actingAs($this->makeMember($i, ['identifier' => 'VUG/CSC/22/1002']));
        $uuid = $this->captureAll();
        $this->postJson("/api/face/{$uuid}/complete", ['liveness' => ['blinks' => 2, 'mouth' => true, 'turns' => true]])->assertOk();

        $admin = $this->makeMember($i, ['member_type' => 'staff']);
        $this->giveRole($admin, 'institution_admin');
        $this->actingAs($admin)->post('/admin/faces/export', ['kind' => 'file', 'scope' => 'all', 'password' => 'short', 'password_confirmation' => 'short'])->assertSessionHasErrors('password');
        $this->actingAs($admin)->post('/admin/faces/export', ['kind' => 'file', 'scope' => 'all', 'password' => 'correct-horse', 'password_confirmation' => 'correct-horse'])->assertSessionHasNoErrors();

        $export = CurrentInstitution::as($i->id, fn () => \App\Models\FaceExport::first());
        $this->assertSame('done', $export->status, (string) $export->error);
        $zip = new \ZipArchive();
        $zip->open(Storage::disk('local')->path($export->path));
        $this->assertNotFalse($zip->locateName('VUG-CSC-22-1002/front.jpg'));
        $this->assertNotFalse($zip->locateName('people.csv'));
        $this->assertFalse(@$zip->getFromName('people.csv')); // encrypted: unreadable without the password
        $zip->setPassword('correct-horse');
        $this->assertStringContainsString('VUG/CSC/22/1002', (string) $zip->getFromName('people.csv'));
    }
}
