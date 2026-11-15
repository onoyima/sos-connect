<?php

namespace App\Jobs;

use App\Services\Push\PushNotifier;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class SendPush implements ShouldQueue
{
    use Dispatchable, Queueable;

    public int $tries = 3;

    public function __construct(public array $userIds, public string $title, public string $body, public array $data = [], public bool $urgent = false)
    {
        if ($urgent) {
            $this->onQueue('urgent');
        }
    }

    public function handle(PushNotifier $push): void
    {
        $push->toUsers($this->userIds, $this->title, $this->body, $this->data, $this->urgent);
    }
}
