<?php

namespace App\Http\Controllers\Api;

use App\Events\InstitutionBroadcast;
use App\Http\Controllers\Controller;
use App\Jobs\SendPush;
use App\Models\AuditLog;
use App\Models\SafetyCheck;
use App\Models\SafetyCheckResponse;
use App\Support\Access;
use App\Support\Audience;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** "Are you safe?" — sent by security/admin during an incident; members answer Safe / Need help. */
class SafetyCheckController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $me = $request->user();
        $checks = SafetyCheck::where('closes_at', '>', now()->subDay())->latest()->limit(20)->get();
        $mine = SafetyCheckResponse::where('user_id', $me->id)->whereIn('safety_check_id', $checks->pluck('id'))->get()->keyBy('safety_check_id');

        return response()->json([
            'checks' => $checks->filter(fn ($c) => $this->inAudience($c->audience, $me) || $c->created_by === $me->id)->map(fn ($c) => [
                'uuid' => $c->uuid, 'id' => $c->id, 'title' => $c->title, 'message' => $c->message,
                'audience_label' => Audience::describe($c->audience),
                'closes_at' => $c->closes_at->toIso8601String(), 'my_answer' => $mine[$c->id]->answer ?? null,
                'can_see_results' => $c->created_by === $me->id || Audience::allowed($me, $c->audience, 'safety_checks.results'),
            ])->values(),
            'audiences' => Access::can($me, 'safety_checks.create') ? Audience::options($me, 'safety_checks.create') : [],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'title' => 'required|string|max:120', 'message' => 'required|string|max:1000',
            'audience' => 'required|array', 'audience.type' => 'required|in:all,staff,students,parents,unit,department,faculty',
            'audience.id' => 'nullable|integer', 'audience.who' => 'nullable|in:all,students,staff', 'hours' => 'nullable|integer|min:1|max:72',
        ]);
        abort_unless(Audience::allowed($me, $data['audience'], 'safety_checks.create'), 403, 'You can only send safety checks to your own area.');
        $check = SafetyCheck::create(['created_by' => $me->id, 'title' => $data['title'], 'message' => $data['message'],
            'audience' => Audience::normalise($data['audience']), 'closes_at' => now()->addHours($data['hours'] ?? 12)]);

        AuditLog::record('safety_check.sent', $check);
        InstitutionBroadcast::dispatch($me->institution_id, 'safety_check.issued', ['uuid' => $check->uuid, 'id' => $check->id,
            'title' => $check->title, 'message' => $check->message, 'audience' => $check->audience, 'closes_at' => $check->closes_at->toIso8601String()]);

        $me->colleagues()->select('id', 'institution_id', 'member_type', 'faculty_unit_id', 'department_unit_id', 'admin_unit_id')
            ->chunkById(1000, function ($users) use ($check) {
                $ids = $users->filter(fn ($u) => $this->inAudience($check->audience, $u))->pluck('id')->all();
                SendPush::dispatch($ids, 'Safety check: '.$check->title, 'Tap to tell us you are safe or need help.', ['type' => 'safety_check', 'uuid' => $check->uuid], true);
            });

        return response()->json(['uuid' => $check->uuid], 201);
    }

    public function respond(Request $request, SafetyCheck $check): JsonResponse
    {
        $me = $request->user();
        abort_unless($this->inAudience($check->audience, $me), 403);
        $data = $request->validate(['answer' => 'required|in:safe,need_help', 'note' => 'nullable|string|max:500',
            'lat' => 'nullable|numeric', 'lng' => 'nullable|numeric']);
        SafetyCheckResponse::updateOrCreate(['safety_check_id' => $check->id, 'user_id' => $me->id],
            $data + ['via' => 'online', 'responded_at' => now()]);

        return response()->json(['ok' => true]);
    }

    public function results(Request $request, SafetyCheck $check): JsonResponse
    {
        $me = $request->user();
        abort_unless($check->created_by === $me->id || Audience::allowed($me, $check->audience, 'safety_checks.results'), 403);
        $responses = $check->responses()->with('user.department')->get();

        return response()->json([
            'safe' => $responses->where('answer', 'safe')->count(),
            'need_help' => $responses->where('answer', 'need_help')->map(fn ($r) => [
                'name' => $r->user->name, 'identifier' => $r->user->identifier, 'phone' => $r->user->phone,
                'department' => $r->user->department?->name, 'note' => $r->note, 'lat' => $r->lat, 'lng' => $r->lng,
                'at' => $r->responded_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    public static function inAudienceStatic(array $a, $u): bool
    {
        return Audience::includes($a, $u);
    }

    private function inAudience(array $a, $u): bool
    {
        return self::inAudienceStatic($a, $u);
    }
}
