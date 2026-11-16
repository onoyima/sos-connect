<?php

namespace Tests\Feature;

use App\Services\Media\VideoCompressor;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MediaCompressionTest extends TestCase
{
    public function test_videos_get_smaller_and_keep_their_name(): void
    {
        if (! VideoCompressor::available()) {
            $this->markTestSkipped('ffmpeg is not installed here.');
        }
        Storage::fake('local');
        $path = 'uploads/1/'.\Illuminate\Support\Str::uuid().'.mp4';
        Storage::disk('local')->put($path, '');
        $file = Storage::disk('local')->path($path);
        Process::run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '4',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', $file])->throw();
        $before = filesize($file);

        $after = VideoCompressor::compress($path);

        $this->assertNotNull($after);
        $this->assertLessThan($before, $after);
        $this->assertSame($after, filesize($file)); // same file, now smaller
    }
}
