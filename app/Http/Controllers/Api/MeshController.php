<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MeshEnvelope;
use App\Services\Mesh\MeshIngest;
use App\Support\CurrentInstitution;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeshController extends Controller
{
    /**
     * Any signed-in phone that has internet uploads the envelopes it carried for others (including
     * other institutions' encrypted envelopes, if their institution allows foreign relay).
     */
    public function relay(Request $request, MeshIngest $ingest): JsonResponse
    {
        $data = $request->validate(['envelopes' => 'required|array|max:'.config('sos.mesh.relay_batch_limit'), 'envelopes.*' => 'array']);
        $gateway = $request->user();

        $results = CurrentInstitution::bypass(function () use ($data, $ingest, $gateway) {
            $out = [];
            foreach ($data['envelopes'] as $e) {
                $out[(string) ($e['id'] ?? '?')] = $ingest->ingest($e, $gateway);
            }

            return $out;
        });

        return response()->json(['results' => $results]);
    }

    /** Envelopes sealed to me (offline direct messages) that reached the server through someone else's phone. */
    public function inbox(Request $request): JsonResponse
    {
        $after = (int) $request->query('after', 0);
        $items = MeshEnvelope::where('to_kind', 'u')->where('to_id', (string) $request->user()->id)
            ->where('result', 'sealed_for_recipient')->where('id', '>', $after)->orderBy('id')->limit(200)->get(['id', 'payload']);

        return response()->json(['after' => $items->last()?->id ?? $after, 'envelopes' => $items->pluck('payload')]);
    }
}
