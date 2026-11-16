<?php

namespace App\Services\Media;

use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * Makes uploaded videos smaller (like WhatsApp): at most 720p (1280 px on the long side), H.264 video with a capped
 * bitrate, AAC audio, and "fast start" so playback begins before the whole file has downloaded. Needs ffmpeg on
 * the server (FFMPEG_PATH); without it videos are kept as they are. The file keeps its name, so messages and status
 * updates that already point at it just get the smaller file.
 */
class VideoCompressor
{
    public static function available(): bool
    {
        $bin = (string) config('sos.media.ffmpeg', 'ffmpeg');

        return $bin !== '' && Process::timeout(10)->run([$bin, '-version'])->successful();
    }

    /** Returns the new size in bytes, or null when the original was kept. */
    public static function compress(string $path): ?int
    {
        $disk = Storage::disk('local');
        if (! $disk->exists($path) || ! self::available()) {
            return null;
        }
        $in = $disk->path($path);
        $before = filesize($in) ?: 0;
        if ($before < (int) config('sos.media.video_min_bytes', 1_500_000) || ! self::hasVideo($in)) {
            return null; // small already, or sound only (a voice note recorded as webm)
        }

        $out = $in.'.small.mp4';
        $ffmpeg = (string) config('sos.media.ffmpeg', 'ffmpeg');
        $run = Process::timeout(900)->run([
            $ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-i', $in,
            '-map', '0:v:0', '-map', '0:a:0?',
            '-vf', "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'",
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-maxrate', '1600k', '-bufsize', '3200k', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
            '-movflags', '+faststart', $out,
        ]);
        $after = is_file($out) ? (filesize($out) ?: 0) : 0;
        if (! $run->successful() || $after === 0 || $after >= $before) {
            @unlink($out);

            return null;
        }
        rename($out, $in); // same name: messages and status updates pointing at it keep working

        return $after;
    }

    private static function hasVideo(string $file): bool
    {
        $probe = preg_replace('/ffmpeg(\.exe)?$/i', 'ffprobe$1', (string) config('sos.media.ffmpeg', 'ffmpeg'));
        $r = Process::timeout(30)->run([$probe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', $file]);

        return $r->successful() ? str_contains($r->output(), 'video') : true; // no ffprobe: let ffmpeg decide
    }
}
