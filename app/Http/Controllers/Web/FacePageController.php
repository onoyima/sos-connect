<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Api\FaceController;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** The guided face capture page: on the website, and inside the phone app (opened with a short-lived ticket). */
class FacePageController extends Controller
{
    public function web(Request $request): Response
    {
        return Inertia::render('Face/Capture', ['mode' => 'web', 'base' => '/api/face', 'state' => FaceController::state($request->user())]);
    }

    public function app(string $ticket): Response
    {
        $me = FaceController::ticketUser($ticket);

        return Inertia::render('Face/Capture', [
            'mode' => 'app',
            'base' => "/api/face/t/{$ticket}",
            'state' => $me ? FaceController::state($me) : null,
            'name' => $me?->name,
        ]);
    }
}
