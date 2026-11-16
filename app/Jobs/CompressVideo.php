<?php

namespace App\Jobs;

use App\Services\Media\VideoCompressor;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class CompressVideo implements ShouldQueue
{
    use Dispatchable, Queueable;

    public int $timeout = 1000;
    public int $tries = 1;

    public function __construct(public string $path) {}

    public function handle(): void
    {
        VideoCompressor::compress($this->path);
    }
}
