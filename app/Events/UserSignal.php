<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use App\Events\Concerns\BroadcastsSafely;
use Illuminate\Foundation\Events\Dispatchable;

/** Direct, per-person events: call signalling, membership changes, sealed mesh deliveries. */
class UserSignal implements ShouldBroadcastNow
{
    use Dispatchable, BroadcastsSafely {
        BroadcastsSafely::dispatch insteadof Dispatchable;
    }

    public int $sig = 0;

    public function __construct(public int $userId, public string $kind, public array $payload)
    {
        // Also kept for a short while, so it still arrives if the websocket server is down (see Realtime).
        $this->sig = \App\Support\Realtime::remember($userId, $kind, $payload);
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('user.'.$this->userId)];
    }

    public function broadcastAs(): string
    {
        return $this->kind;
    }

    public function broadcastWith(): array
    {
        return $this->payload + ['_sig' => $this->sig]; // lets the app ignore a copy it already got
    }
}
