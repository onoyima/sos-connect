<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConversationMember;
use App\Models\Device;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DirectoryController extends Controller
{
    /** Search people in MY institution only. Results show name, role and department — no contact details for students. */
    public function search(Request $request): JsonResponse
    {
        $me = $request->user();
        abort_unless(Permissions::allows($me, 'directory.search'), 403);
        $q = $request->validate(['q' => 'required|string|min:2|max:60'])['q'];

        $type = $request->query('type'); // optional: student | staff
        $people = $me->colleagues()->with('department')
            ->where('id', '!=', $me->id)->whereNotIn('member_type', ['relay'])
            ->when(in_array($type, ['student', 'staff'], true), fn ($w) => $w->where('member_type', $type))
            ->where(fn ($w) => $w->where('name', 'like', '%'.addcslashes($q, '%_').'%')->orWhere('identifier', $q)->orWhere('email', $q))
            ->orderBy('name')->limit(25)->get();

        // For each person: can I chat now, do I need to ask first, or is a request already waiting?
        $ids = $people->pluck('id');
        $pending = \App\Models\ChatRequest::where('status', 'pending')
            ->where(fn ($w) => $w->where(fn ($x) => $x->where('from_id', $me->id)->whereIn('to_id', $ids))
                ->orWhere(fn ($x) => $x->where('to_id', $me->id)->whereIn('from_id', $ids)))->get();

        return response()->json(['people' => $people->map(function ($p) use ($me, $pending) {
            [$mode, $why] = \App\Services\Chat\ContactPolicy::decide($me, $p);
            if ($mode === \App\Services\Chat\ContactPolicy::REQUEST && ! \App\Support\Modules::enabled($me->institution, 'chat_requests')) {
                [$mode, $why] = [\App\Services\Chat\ContactPolicy::NONE, 'Chat requests are switched off'];
            }
            $out = $pending->first(fn ($r) => $r->from_id === $me->id && $r->to_id === $p->id);
            $in = $pending->first(fn ($r) => $r->to_id === $me->id && $r->from_id === $p->id);

            return $p->publicProfile($me) + [
                'reach' => $in ? 'accept' : ($out ? 'requested' : $mode), // direct | request | requested | accept | none
                'request_id' => ($in ?? $out)?->id,
                'reach_note' => $mode === \App\Services\Chat\ContactPolicy::NONE ? $why : null,
            ];
        })]);
    }

    /**
     * Encryption keys of people I have direct chats with, so my phone can seal messages to them offline.
     * Public keys only; limited to existing contacts to avoid handing out a full institution map.
     */
    public function contactKeys(Request $request): JsonResponse
    {
        $me = $request->user();
        $peerIds = ConversationMember::whereIn('conversation_id', ConversationMember::where('user_id', $me->id)
            ->whereHas('conversation', fn ($q) => $q->where('type', 'direct'))->select('conversation_id'))
            ->where('user_id', '!=', $me->id)->pluck('user_id');

        $devices = Device::whereIn('user_id', $peerIds)->whereNull('revoked_at')
            ->where('cert_expires_at', '>', now())->get(['id', 'user_id', 'box_public_key']);

        return response()->json(['keys' => $devices->map(fn ($d) => ['user_id' => $d->user_id, 'device_id' => $d->id, 'box_public_key' => $d->box_public_key])]);
    }
}
