<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use App\Events\Concerns\BroadcastsSafely;
use Illuminate\Foundation\Events\Dispatchable;

/** One event per conversation channel, not one per member: cheap even for a 20,000-member group. */
class MessageCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, BroadcastsSafely {
        BroadcastsSafely::dispatch insteadof Dispatchable;
    }

    public function __construct(public Message $message, public string $kind = 'message.created') {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->message->conversation_id)];
    }

    public function broadcastAs(): string
    {
        return $this->kind; // message.created | message.updated | message.deleted
    }

    public function broadcastWith(): array
    {
        return $this->message->toClient();
    }
}
