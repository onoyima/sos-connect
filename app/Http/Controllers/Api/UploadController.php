<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Files are stored privately per institution with random names; the type is detected from the bytes,
 * never from the client's filename or Content-Type. Phones compress images and voice before upload.
 */
class UploadController extends Controller
{
    private const ALLOWED = [
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif',
        'video/quicktime' => 'mov', 'video/3gpp' => '3gp',
        'audio/mp4' => 'm4a', 'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac', 'audio/ogg' => 'ogg', 'audio/mpeg' => 'mp3', 'video/mp4' => 'mp4',
        // Voice notes recorded in a browser (Chrome, Edge, Firefox). Audio-only webm is often reported as video/webm.
        'audio/webm' => 'webm', 'video/webm' => 'webm',
        'application/pdf' => 'pdf',
    ];

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $voice = str_starts_with((string) $request->file('file')?->getMimeType(), 'audio/') || str_starts_with((string) $request->file('file')?->getMimeType(), 'video/webm');
        abort_unless(\App\Support\Access::can($me, 'chat.files') || \App\Support\Access::can($me, 'status.post')
            || ($voice && \App\Support\Access::can($me, 'chat.use') && \App\Support\Modules::enabled($me->institution, 'voice_notes')), 403, 'Sending files is turned off.');
        $request->validate(['file' => 'required|file|max:51200']); // 50 MB (status videos); photos and voice notes are far smaller
        $file = $request->file('file');
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());
        abort_unless(isset(self::ALLOWED[$mime]), 415, 'This file type is not allowed.');

        $iid = $request->user()->institution_id;
        $name = Str::uuid().'.'.self::ALLOWED[$mime];
        Storage::disk('local')->putFileAs("uploads/{$iid}", $file, $name);

        // Videos are made smaller in the background (the person doesn't wait). Phones already send them compressed.
        if (str_starts_with($mime, 'video/') && config('sos.media.compress_videos')) {
            config('queue.default') === 'sync'
                ? \App\Jobs\CompressVideo::dispatchAfterResponse("uploads/{$iid}/{$name}")
                : \App\Jobs\CompressVideo::dispatch("uploads/{$iid}/{$name}");
        }

        return response()->json(['path' => "uploads/{$iid}/{$name}", 'mime' => $mime, 'size' => $file->getSize()], 201);
    }

    public function show(Request $request, string $institution, string $name): \Symfony\Component\HttpFoundation\BinaryFileResponse
    {
        abort_unless((int) $institution === $request->user()->institution_id, 404);
        abort_unless(preg_match('/^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/', $name) === 1, 404);
        $path = "uploads/{$institution}/{$name}";
        abort_unless(Storage::disk('local')->exists($path), 404);
        $mime = Storage::disk('local')->mimeType($path);
        $inline = str_starts_with($mime, 'image/') || str_starts_with($mime, 'audio/') || str_starts_with($mime, 'video/');

        // A file response answers "Range" requests, which Safari and phones need to play and skip through
        // voice notes and videos.
        return response()->file(Storage::disk('local')->path($path), [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            // Even if a file were crafted to look like a page, it can't run anything when opened directly.
            'Content-Security-Policy' => "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
            'Cache-Control' => 'private, max-age=86400',
            'Content-Disposition' => ($inline ? 'inline' : 'attachment').'; filename="'.$name.'"',
        ]);
    }
}
