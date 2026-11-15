<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use App\Events\Concerns\BroadcastsSafely;
use Illuminate\Foundation\Events\Dispatchable;

/** Announcements and safety checks: one event to every signed-in member of the institution. */
class InstitutionBroadcast implements ShouldBroadcastNow
{
    use Dispatchable, BroadcastsSafely {
        BroadcastsSafely::dispatch insteadof Dispatchable;
    }

    public function __construct(public int $institutionId, public string $kind, public array $payload) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('institution.'.$this->institutionId)];
    }

    public function broadcastAs(): string
    {
        return $this->kind; // announcement.published | safety_check.issued
    }

    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
