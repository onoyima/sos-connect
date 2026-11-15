<?php

namespace App\Events;

use App\Models\SosAlert;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use App\Events\Concerns\BroadcastsSafely;
use Illuminate\Foundation\Events\Dispatchable;

/** Sent to the institution's responders and to the person who raised the alert. */
class SosChanged implements ShouldBroadcastNow
{
    use Dispatchable, BroadcastsSafely {
        BroadcastsSafely::dispatch insteadof Dispatchable;
    }

    public function __construct(public SosAlert $alert, public string $change) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('institution.'.$this->alert->institution_id.'.responders'),
            new PrivateChannel('user.'.$this->alert->user_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'sos.'.$this->change; // sos.raised | sos.updated
    }

    public function broadcastWith(): array
    {
        $this->alert->loadMissing(['user.department', 'responses.user']);

        return $this->alert->toClient(responderView: true);
    }
}
