<?php

namespace App\Services\Sos;

use App\Events\SosChanged;
use App\Events\UserSignal;
use App\Jobs\SendPush;
use App\Models\AuditLog;
use App\Models\SosAlert;
use App\Models\SosResponse;
use App\Models\User;
use App\Support\Access;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;

/**
 * SOS works the same whether it arrives online, via a gateway phone that carried it over Bluetooth/Wi-Fi,
 * or from the person's own outbox when they reconnect. client_id (made on the phone) prevents duplicates.
 */
class SosService
{
    public function raise(User $user, array $data, string $via = 'online'): SosAlert
    {
        if (! $user->isActive()) {
            throw new AuthorizationException('Account not active.');
        }

        $existing = SosAlert::where('user_id', $user->id)->where('client_id', $data['client_id'])->first();
        if ($existing) {
            // A later copy may carry a better GPS fix (phones keep refining location).
            $this->maybeImproveLocation($existing, $data);

            return $existing;
        }

        $raisedAt = isset($data['raised_at']) ? Carbon::parse($data['raised_at']) : now();

        $alert = SosAlert::create([
            'institution_id' => $user->institution_id,
            'user_id' => $user->id,
            'client_id' => $data['client_id'],
            'category' => in_array($data['category'] ?? '', SosAlert::CATEGORIES, true) ? $data['category'] : 'other',
            'message' => isset($data['message']) ? mb_substr($data['message'], 0, 500) : null,
            'lat' => $data['lat'] ?? null,
            'lng' => $data['lng'] ?? null,
            'accuracy_m' => isset($data['accuracy_m']) ? (int) $data['accuracy_m'] : null,
            'location_label' => isset($data['location_label']) ? mb_substr($data['location_label'], 0, 255) : null,
            'status' => 'open',
            'via' => $via,
            'raised_at' => $raisedAt->isFuture() ? now() : $raisedAt,
        ]);

        AuditLog::record('sos.raised', $alert, ['via' => $via, 'category' => $alert->category], $user->institution_id);
        SosChanged::dispatch($alert, 'raised');

        // Push to responders right after the response is sent; SOS skips the normal queue.
        // Everyone allowed to see SOS alerts from this person's area (their department, faculty or unit,
        // or the whole institution), e.g. campus security, the clinic, their hall warden.
        $responders = self::respondersFor($alert);
        $place = $alert->location_label ?: ($alert->lat ? 'location attached' : 'no location');
        SendPush::dispatchAfterResponse($responders, 'SOS: '.ucfirst($alert->category), "{$user->name} needs help ({$place}).",
            ['type' => 'sos', 'alert_id' => $alert->id], true);

        // The alarm: each responder's open pages and apps sound a siren and take over the screen straight away
        // (kept for a few minutes too, so it still arrives when live updates are down).
        $payload = self::alarm($alert);
        foreach ($responders as $id) {
            UserSignal::dispatch((int) $id, 'sos.alarm', $payload);
        }

        return $alert;
    }

    public function respond(SosAlert $alert, User $responder, string $action, ?string $note = null, ?float $lat = null, ?float $lng = null): SosAlert
    {
        $isOwner = $alert->user_id === $responder->id;
        $raiser = $alert->user;
        $isResponder = $raiser ? Access::canOnUser($responder, 'sos.respond', $raiser) : Access::canEverywhere($responder, 'sos.respond');

        if ($responder->institution_id !== $alert->institution_id || (! $isResponder && ! ($isOwner && in_array($action, ['cancelled', 'note'], true)))) {
            throw new AuthorizationException('Not allowed to update this alert.');
        }

        SosResponse::create(['sos_alert_id' => $alert->id, 'user_id' => $responder->id, 'action' => $action,
            'note' => $note ? mb_substr($note, 0, 1000) : null, 'lat' => $lat, 'lng' => $lng]);

        $updates = match ($action) {
            'acknowledged' => ['status' => 'acknowledged', 'acknowledged_at' => $alert->acknowledged_at ?? now()],
            'on_my_way', 'arrived' => ['status' => 'responding', 'acknowledged_at' => $alert->acknowledged_at ?? now()],
            'resolved', 'false_alarm' => ['status' => $action, 'resolved_at' => now(), 'resolved_by' => $responder->id, 'resolution_note' => $note],
            'cancelled' => ['status' => 'cancelled', 'resolved_at' => now(), 'resolved_by' => $responder->id],
            default => [],
        };
        if ($updates) {
            $alert->update($updates);
        }

        AuditLog::record('sos.'.$action, $alert, [], $alert->institution_id);
        SosChanged::dispatch($alert->fresh(), 'updated');

        // Everyone else's alarm for this alert stops ringing once someone is on it (and closes when it's over).
        if ($action !== 'note') {
            $update = ['id' => $alert->id, 'status' => $alert->status, 'action' => $action, 'by' => $responder->name, 'by_id' => $responder->id];
            foreach (array_diff(self::respondersFor($alert), [$responder->id]) as $id) {
                UserSignal::dispatch((int) $id, 'sos.update', $update);
            }
        }

        if (! $isOwner && in_array($action, ['acknowledged', 'on_my_way', 'arrived'], true)) {
            $text = ['acknowledged' => 'Help has seen your alert.', 'on_my_way' => 'A responder is on the way.', 'arrived' => 'A responder has arrived.'][$action];
            SendPush::dispatchAfterResponse([$alert->user_id], 'SOS update', $text, ['type' => 'sos', 'alert_id' => $alert->id], true);
        }

        return $alert;
    }

    /** Called every minute by the scheduler: unacknowledged alerts go to senior staff. */
    public function escalateStale(): int
    {
        $cutoff = now()->subSeconds(config('sos.sos.escalate_after_seconds'));
        $count = 0;
        SosAlert::where('status', 'open')->whereNull('escalated_at')->where('raised_at', '<', $cutoff)
            ->each(function (SosAlert $alert) use (&$count) {
                $alert->update(['escalated_at' => now()]);
                $ids = array_values(array_diff(Access::holders($alert->institution_id, 'sos.view'), [$alert->user_id])); // people who see every alert
                SendPush::dispatch($ids, 'SOS not yet answered', 'An SOS alert has had no response for over 2 minutes.',
                    ['type' => 'sos', 'alert_id' => $alert->id], true);
                SosChanged::dispatch($alert, 'updated');
                $payload = self::alarm($alert) + ['escalated' => true];
                foreach (array_unique(array_merge($ids, self::respondersFor($alert))) as $id) {
                    UserSignal::dispatch((int) $id, 'sos.alarm', $payload); // sound again, louder message
                }
                $count++;
            });

        return $count;
    }

    /** Who should be alarmed: everyone allowed to see SOS alerts from this person's area (never the person themself). */
    public static function respondersFor(SosAlert $alert): array
    {
        $raiser = $alert->loadMissing('user')->user;

        return array_values(array_diff(Access::holders($alert->institution_id, 'sos.view', $raiser?->unitIds() ?? []), [$alert->user_id]));
    }

    /** What the alarm screen shows. */
    public static function alarm(SosAlert $alert): array
    {
        $alert->loadMissing('user.department');
        $u = $alert->user;

        return [
            'id' => $alert->id, 'category' => $alert->category, 'message' => $alert->message ? mb_substr($alert->message, 0, 200) : null,
            'status' => $alert->status, 'raised_at' => $alert->raised_at?->toIso8601String(),
            'location_label' => $alert->location_label, 'lat' => $alert->lat, 'lng' => $alert->lng, 'accuracy_m' => $alert->accuracy_m, 'via' => $alert->via,
            'user' => ['name' => $u?->name, 'identifier' => $u?->identifier, 'phone' => $u?->phone, 'department' => $u?->department?->name, 'residence' => $u?->residence],
        ];
    }

    private function maybeImproveLocation(SosAlert $alert, array $data): void
    {
        $acc = isset($data['accuracy_m']) ? (int) $data['accuracy_m'] : null;
        if (isset($data['lat'], $data['lng']) && $alert->isOpen() && ($alert->accuracy_m === null || ($acc && $acc < $alert->accuracy_m))) {
            $alert->update(['lat' => $data['lat'], 'lng' => $data['lng'], 'accuracy_m' => $acc]);
            SosChanged::dispatch($alert, 'updated');
        }
    }

}
