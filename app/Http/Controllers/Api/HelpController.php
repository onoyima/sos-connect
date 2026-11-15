<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Page;
use App\Services\Pages\PageLibrary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Help pages for the phone app. */
class HelpController extends Controller
{
    public function index(Request $request, PageLibrary $pages): JsonResponse
    {
        return response()->json(['pages' => $pages->visible($request->user(), 'help')->map(fn (Page $p) => ['slug' => $p->slug, 'title' => $p->title])->values()]);
    }

    public function show(Request $request, PageLibrary $pages, string $slug): JsonResponse
    {
        $p = $pages->visible($request->user(), 'help')->firstWhere('slug', $slug) ?? abort(404);

        return response()->json(['title' => $p->title, 'html' => PageLibrary::render($p->body)['html']]);
    }
}
