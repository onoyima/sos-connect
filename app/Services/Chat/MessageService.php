<?php

namespace App\Services\Chat;

use App\Events\MessageCreated;
use App\Jobs\SendPush;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Message;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;

/**
 * The one way a message enters the system, whether it arrives online, through a LAN/Bluetooth relay
 * (uploaded later by a gateway phone) or from the sender's own offline outbox. The phone-generated
 * client_id makes all three paths idempotent: the same message is stored once.
 */
class MessageService
{
    /** Groups bigger than this only push for admin posts, to avoid 10,000 notifications per chat line. */
    private const PUSH_MEMBER_LIMIT = 300;

    public function send(User $sender, Conversation $conversation, array $data, string $via = 'online'): Message
    {
        if (! $sender->isActive() || $sender->institution_id !== $conversation->institution_id) {
            throw new AuthorizationException('Not allowed.');
        }
        if (! \App\Support\Modules::conversationVisible($sender->institution, $conversation)) {
            throw new AuthorizationException('This group is switched off.');
        }
        $type = $data['type'] ?? 'text';
        if ($type === 'sticker' && ! \App\Support\Modules::enabled($sender->institution, 'stickers')) {
            throw new AuthorizationException('Stickers are switched off by your institution.');
        }
        if ($type === 'voice' && ! \App\Support\Modules::enabled($sender->institution, 'voice_notes')) {
            throw new AuthorizationException('Voice notes are switched off by your institution.');
        }
        if ($type === 'sticker' || $type === 'voice') {
            // A sticker is one of the built-in set, by name; nothing is uploaded.
            if ($type === 'sticker') {
                $data['meta'] = ['sticker' => (string) preg_replace('/[^a-z0-9_]/', '', (string) ($data['meta']['sticker'] ?? ''))];
                if ($data['meta']['sticker'] === '') {
                    throw new AuthorizationException('Unknown sticker.');
                }
            }
            // Voice notes have their own switch, separate from photos and files.
        } elseif (($data['type'] ?? 'text') !== 'text' && ! \App\Support\Access::can($sender, 'chat.files')) {
            throw new AuthorizationException('Sending photos and files is turned off.');
        }
        if (! $conversation->canPost($sender)) {
            throw new AuthorizationException($conversation->membershipFor($sender)
                ? 'Only group admins can post in this group.'
                : 'You are not a member of this conversation.');
        }

        $existing = Message::where('sender_id', $sender->id)->where('client_id', $data['client_id'])->first();
        if ($existing) {
            return $existing;
        }

        $sentAt = isset($data['sent_at']) ? Carbon::parse($data['sent_at']) : now();
        if ($sentAt->isFuture()) {
            $sentAt = now(); // phone clocks drift; never let a message sort into the future
        }

        $meta = $data['meta'] ?? [];
        unset($meta['mentions']); // only the server decides who was mentioned
        $mentions = $this->mentions($conversation, $sender, $data['mentions'] ?? []);
        if ($mentions) {
            $meta['mentions'] = $mentions;
        }
        $replyTo = ! empty($data['reply_to_id'])
            ? Message::withTrashed()->where('conversation_id', $conversation->id)->whereKey((int) $data['reply_to_id'])->value('id')
            : null;

        $message = Message::create([
            'institution_id' => $conversation->institution_id,
            'conversation_id' => $conversation->id,
            'sender_id' => $sender->id,
            'client_id' => $data['client_id'],
            'type' => $data['type'] ?? 'text',
            'body' => $data['body'] ?? null,
            'meta' => $meta ?: null,
            'reply_to_id' => $replyTo,
            'via' => $via,
            'sent_at' => $sentAt,
        ]);
        $conversation->forceFill(['last_message_at' => now()])->save();

        $message->setRelation('sender', $sender);
        MessageCreated::dispatch($message);
        $this->push($sender, $conversation, $message);

        return $message;
    }

    /**
     * A notice in a chat that isn't anyone's words, e.g. "Voice call started" with a Join button. Shown like a
     * message from $by so phones and the website pick it up the normal way; no push (the call rings separately).
     */
    public function system(User $by, Conversation $conversation, string $clientId, string $body, array $meta): Message
    {
        $message = Message::firstOrCreate(['sender_id' => $by->id, 'client_id' => $clientId], [
            'institution_id' => $conversation->institution_id, 'conversation_id' => $conversation->id,
            'type' => 'system', 'body' => $body, 'meta' => $meta, 'via' => 'online', 'sent_at' => now(),
        ]);
        $conversation->forceFill(['last_message_at' => now()])->save();
        $message->setRelation('sender', $by);
        MessageCreated::dispatch($message);

        return $message;
    }

    /** People @mentioned, kept only if they're in the conversation: [{id, name}]. */
    private function mentions(Conversation $conversation, User $sender, array $ids): array
    {
        $ids = array_slice(array_unique(array_map('intval', array_filter($ids, 'is_numeric'))), 0, 50);
        if (! $ids || $conversation->type === 'direct') {
            return [];
        }

        return User::whereIn('id', ConversationMember::where('conversation_id', $conversation->id)->whereIn('user_id', $ids)->select('user_id'))
            ->where('id', '!=', $sender->id)->get(['id', 'name'])->map(fn ($u) => ['id' => $u->id, 'name' => $u->name])->values()->all();
    }

    private function push(User $sender, Conversation $conversation, Message $message): void
    {
        $members = ConversationMember::alertable(ConversationMember::where('conversation_id', $conversation->id)
            ->where('user_id', '!=', $sender->id));

        $count = (clone $members)->count();
        $senderIsAdmin = (bool) $conversation->membershipFor($sender)?->isAdmin() || $conversation->posting === 'admins';

        $preview = match ($message->type) {
            'image' => 'Photo', 'voice' => 'Voice note', 'file' => 'File', 'sticker' => 'Sticker',
            default => mb_substr((string) $message->body, 0, 100),
        };
        $title = $conversation->type === 'direct' ? $sender->name : ($conversation->name ?? 'Group').' · '.$sender->name;

        // People who were @mentioned are told even if they muted the group or it's very big.
        $mentioned = array_column($message->meta['mentions'] ?? [], 'id');
        if ($mentioned) {
            SendPush::dispatch($mentioned, $sender->name.' mentioned you in '.($conversation->name ?? 'a group'), $preview, [
                'type' => 'message', 'conversation_id' => $conversation->id,
            ]);
        }
        if ($count > self::PUSH_MEMBER_LIMIT && ! $senderIsAdmin) {
            return;
        }

        $members->whereNotIn('user_id', $mentioned)->select(['id', 'user_id'])->chunkById(1000, function ($chunk) use ($title, $preview, $conversation) {
            SendPush::dispatch($chunk->pluck('user_id')->all(), $title, $preview, [
                'type' => 'message', 'conversation_id' => $conversation->id,
            ]);
        }, 'id');
    }
}
