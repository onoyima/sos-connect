<?php

use App\Models\ConversationMember;
use App\Support\Permissions;
use Illuminate\Support\Facades\Broadcast;

// Every channel check confirms the account is active AND belongs to the right institution.

Broadcast::channel('user.{id}', fn ($user, $id) => $user->isActive() && (int) $user->id === (int) $id);

Broadcast::channel('conversation.{id}', fn ($user, $id) => $user->isActive()
    && ConversationMember::where('conversation_id', $id)->where('user_id', $user->id)
        ->whereHas('conversation', fn ($q) => $q->withoutGlobalScopes()->where('institution_id', $user->institution_id))->exists());

Broadcast::channel('institution.{id}', fn ($user, $id) => $user->isActive() && (int) $user->institution_id === (int) $id);

Broadcast::channel('institution.{id}.responders', fn ($user, $id) => (int) $user->institution_id === (int) $id
    && Permissions::allows($user, 'sos.view'));
