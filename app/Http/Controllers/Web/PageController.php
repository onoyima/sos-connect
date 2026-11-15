<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** React pages load their data from /api (same session), so these just pick the page. */
class PageController extends Controller
{
    public function chats(Request $request, ?int $conversation = null): Response
    {
        return Inertia::render('Chats/Index', ['openConversationId' => $conversation]);
    }

    public function sos(): Response
    {
        return Inertia::render('Sos/Index');
    }

    public function announcements(): Response
    {
        return Inertia::render('Announcements/Index');
    }

    public function status(): Response
    {
        return Inertia::render('Status/Index');
    }

    public function calls(): Response
    {
        return Inertia::render('Calls/Index');
    }

    public function safety(): Response
    {
        return Inertia::render('Safety/Index');
    }

    public function privacy(): Response
    {
        return Inertia::render('Account/Privacy', ['policyVersion' => config('sos.legal.policy_version')]);
    }
}
