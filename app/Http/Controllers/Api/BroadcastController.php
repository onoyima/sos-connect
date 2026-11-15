<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Broadcast;
use App\Support\Modules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The pop-ups and marquee lines running for me right now (the website and the phone ask when they open). */
class BroadcastController extends Controller
{
    public function active(Request $request): JsonResponse
    {
        $me = $request->user();
        if (! $me->institution_id || ! Modules::enabled($me->institution, 'broadcasts')) {
            return response()->json(['popups' => [], 'marquees' => []]);
        }
        $live = Broadcast::live()->latest()->limit(50)->get()->filter(fn (Broadcast $b) => $b->isFor($me));

        return response()->json([
            'popups' => $live->where('kind', 'popup')->map->toClient()->values(),
            'marquees' => $live->where('kind', 'marquee')->map->toClient()->values(),
        ]);
    }
}
