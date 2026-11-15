<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Message extends Model
{
    use BelongsToInstitution, SoftDeletes;

    protected $fillable = ['institution_id', 'conversation_id', 'sender_id', 'client_id', 'type', 'body', 'meta', 'reply_to_id', 'via', 'sent_at', 'edited_at'];

    protected function casts(): array
    {
        return ['body' => 'encrypted', 'meta' => 'array', 'sent_at' => 'datetime', 'edited_at' => 'datetime'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    /** The message this one replies to (kept even if it was later deleted, so the quote can say so). */
    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to_id')->withTrashed()->with('sender:id,name');
    }

    /** Short quote shown above a reply. */
    public function quote(): ?array
    {
        $r = $this->reply_to_id ? $this->replyTo : null;
        if (! $r) {
            return null;
        }

        return ['id' => $r->id, 'client_id' => $r->client_id, 'sender_id' => $r->sender_id, 'sender_name' => $r->sender?->name, 'type' => $r->type,
            'body' => $r->trashed() ? null : mb_substr((string) $r->body, 0, 160), 'deleted' => $r->trashed()];
    }

    public function toClient(): array
    {
        return [
            'id' => $this->id,
            'client_id' => $this->client_id,
            'conversation_id' => $this->conversation_id,
            'sender_id' => $this->sender_id,
            'sender_name' => $this->sender?->name,
            'type' => $this->type,
            'body' => $this->trashed() ? null : $this->body,
            'meta' => $this->trashed() ? null : $this->meta,
            'reply_to_id' => $this->reply_to_id,
            'reply_to' => $this->trashed() ? null : $this->quote(),
            'mentions' => $this->trashed() ? [] : ($this->meta['mentions'] ?? []),
            'via' => $this->via,
            'sent_at' => $this->sent_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'edited' => (bool) $this->edited_at,
            'deleted' => $this->trashed(),
        ];
    }
}
