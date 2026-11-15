<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SosAlert;
use App\Services\Sos\SosService;
use App\Support\Access;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SosController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        $responder = Access::can($me, 'sos.view');

        $alerts = SosAlert::with(['user.department', 'responses.user'])->visibleTo($me)
            ->when($request->boolean('open'), fn ($q) => $q->whereIn('status', SosAlert::OPEN_STATES))
            ->latest('raised_at')->limit(100)->get();

        return response()->json([
            'alerts' => $alerts->map(fn ($a) => $a->toClient(responderView: $a->user_id !== $me->id || $responder)),
            'responder' => $responder,
        ]);
    }

    public function store(Request $request, SosService $sos): JsonResponse
    {
        abort_unless(Permissions::allows($request->user(), 'sos.raise'), 403);
        $data = $request->validate([
            'client_id' => 'required|uuid',
            'category' => 'required|in:'.implode(',', SosAlert::CATEGORIES),
            'message' => 'nullable|string|max:500',
            'lat' => 'nullable|numeric|between:-90,90',
            'lng' => 'nullable|numeric|between:-180,180',
            'accuracy_m' => 'nullable|integer|min:0|max:100000',
            'location_label' => 'nullable|string|max:255',
            'raised_at' => 'nullable|date',
        ]);

        $alert = $sos->raise($request->user(), $data);

        return response()->json(['alert' => $alert->toClient()], 201);
    }

    public function respond(Request $request, SosAlert $alert, SosService $sos): JsonResponse
    {
        $data = $request->validate([
            'action' => 'required|in:acknowledged,on_my_way,arrived,note,resolved,false_alarm,cancelled',
            'note' => 'nullable|string|max:1000',
            'lat' => 'nullable|numeric|between:-90,90',
            'lng' => 'nullable|numeric|between:-180,180',
        ]);
        $alert = $sos->respond($alert, $request->user(), $data['action'], $data['note'] ?? null, $data['lat'] ?? null, $data['lng'] ?? null);

        return response()->json(['alert' => $alert->fresh(['user.department', 'responses.user'])->toClient(Access::can($request->user(), 'sos.view'))]);
    }
}
