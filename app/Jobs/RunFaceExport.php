<?php

namespace App\Jobs;

use App\Models\FaceExport;
use App\Services\Faces\FaceExporter;
use App\Support\CurrentInstitution;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** Builds a face export in the background (or straight away when the queue runs "sync"). Encrypted: it carries the file password. */
class RunFaceExport implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, Queueable;

    public int $tries = 1;

    public int $timeout = 3600;

    public function __construct(public int $exportId, public int $institutionId, public ?string $password = null)
    {
    }

    public function handle(FaceExporter $exporter): void
    {
        CurrentInstitution::as($this->institutionId, function () use ($exporter) {
            $export = FaceExport::find($this->exportId);
            if ($export && $export->status === 'queued') {
                $exporter->run($export, $this->password);
            }
        });
    }
}
