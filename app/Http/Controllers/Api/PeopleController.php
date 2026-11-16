<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ChatRequest;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Auth\InstitutionLogin;
use App\Services\Chat\ContactPolicy;
use App\Services\Connector\ConnectorClient;
use App\Support\PhoneNumber;
use App\Support\Sounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Someone's profile (with WhatsApp), my own contact details and sound choices, and adding staff from the records. */
class PeopleController extends Controller
{
    public function show(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $p = $me->colleagues()->with('department')->findOrFail($id);
        [$mode, $why] = ContactPolicy::decide($me, $p);
        $pending = ChatRequest::where('status', 'pending')->where(fn ($w) => $w->where(fn ($x) => $x->where('from_id', $me->id)->where('to_id', $p->id))
            ->orWhere(fn ($x) => $x->where('from_id', $p->id)->where('to_id', $me->id)))->first();
        $direct = DB::table('conversations as c')->where('c.type', 'direct')->where('c.institution_id', $me->institution_id)
            ->whereExists(fn ($q) => $q->from('conversation_members')->whereColumn('conversation_id', 'c.id')->where('user_id', $me->id))
            ->whereExists(fn ($q) => $q->from('conversation_members')->whereColumn('conversation_id', 'c.id')->where('user_id', $p->id))
            ->value('c.id');
        $shared = DB::table('conversation_members as a')->join('conversation_members as b', 'a.conversation_id', '=', 'b.conversation_id')
            ->join('conversations as c', 'c.id', '=', 'a.conversation_id')->where('c.type', '!=', 'direct')
            ->where('a.user_id', $me->id)->where('b.user_id', $p->id)->count();

        return response()->json(['person' => $p->publicProfile($me) + [
            'reach' => $pending ? ($pending->to_id === $me->id ? 'accept' : 'requested') : $mode,
            'request_id' => $pending?->id,
            'reach_note' => $mode === ContactPolicy::NONE ? $why : null,
            'conversation_id' => $direct ? (int) $direct : null,
            'shared_groups' => $shared,
        ]]);
    }

    public function contact(Request $request): JsonResponse
    {
        return response()->json(['contact' => self::contactOf($request->user())]);
    }

    /** My WhatsApp number (the school's phone number is never changed) and whether others see it. */
    public function saveContact(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'whatsapp' => ['nullable', 'string', 'max:24', 'regex:/^\+?[0-9 ()-]{7,24}$/'],
            'show_whatsapp' => 'required|boolean',
        ], ['whatsapp.regex' => 'Enter a phone number, e.g. 0803 000 0000 or +234 803 000 0000.']);
        $number = trim((string) ($data['whatsapp'] ?? ''));
        if ($number !== '' && ! PhoneNumber::international($number, $me->institution?->country)) {
            abort(422, 'That phone number looks incomplete.');
        }
        $me->forceFill(['whatsapp' => $number !== '' ? $number : null, 'show_whatsapp' => $data['show_whatsapp']])->save();

        return response()->json(['contact' => self::contactOf($me)]);
    }

    public static function contactOf(User $me): array
    {
        $country = $me->institution?->country;

        return [
            'school_phone' => PhoneNumber::pretty(PhoneNumber::international($me->phone, $country)),
            'whatsapp' => $me->whatsapp,
            'show_whatsapp' => $me->show_whatsapp !== false,
            'shown_as' => PhoneNumber::pretty($me->whatsappNumber($country)),
        ];
    }

    public function sounds(Request $request): JsonResponse
    {
        return response()->json(['sounds' => Sounds::for($request->user())] + Sounds::catalog());
    }

    public function saveSounds(Request $request): JsonResponse
    {
        $me = $request->user();
        $rules = [];
        foreach (Sounds::KINDS as $k => $def) {
            $rules["sounds.{$k}"] = ['sometimes', 'string', 'in:'.implode(',', array_keys($def['set'] === 'rings' ? Sounds::RINGS : Sounds::TONES))];
        }
        $data = $request->validate(['sounds' => 'required|array'] + $rules);
        $prefs = $me->preferences ?? [];
        $prefs['sounds'] = array_merge(Sounds::for($me), array_intersect_key($data['sounds'], Sounds::KINDS));
        $me->forceFill(['preferences' => $prefs])->save();

        return response()->json(['sounds' => Sounds::for($me)]);
    }

    /**
     * A staff member found in the school's records who has never signed in: their SOS Connect account is opened from
     * the records (no password; they sign in with their school login as usual), so a chat or request can reach them.
     */
    public function addFromRecords(Request $request, InstitutionLogin $login): JsonResponse
    {
        $me = $request->user();
        $ext = $request->validate(['external_id' => ['required', 'string', 'regex:/^(st|sf)-\d+$/']])['external_id'];
        // Students and alumni find students and alumni; staff find anyone.
        $staff = in_array($me->member_type, ['staff', 'admin'], true);
        abort_unless($staff || (in_array($me->member_type, ['student', 'alumni'], true) && str_starts_with($ext, 'st-')), 403, "You can't add this person.");
        $i = $me->institution;
        abort_unless($i?->connector, 422, "Your school's records aren't connected.");

        $existing = User::inInstitution($i->id)->where('external_id', $ext)->first();
        if ($existing) {
            abort_if($existing->status !== 'active', 422, 'This person can\'t be reached on SOS Connect.');

            return $this->show($request, $existing->id);
        }
        abort_if(\App\Services\Billing\Billing::memberLimitReached($i), 422, "Your school has reached its plan's member limit, so new accounts can't be opened.");
        try {
            $profile = (new ConnectorClient($i->connector))->member($ext);
        } catch (\Throwable $e) {
            report($e);
            abort(503, "Couldn't reach your school's records. Try again shortly.");
        }
        abort_unless($profile && $profile->status === 'active' && in_array($profile->type, ['staff', 'student', 'alumni'], true), 404, 'Not found in the records, or no longer at the school.');

        $user = $login->upsertMember($i, $profile);
        $user->forceFill(['last_seen_at' => null])->save(); // they haven't actually been here yet
        if ($profile->type === 'alumni') {
            // Alumni get their role the first time one is added (as at sign-in).
            app(\App\Services\Access\RoleManager::class)->installDefaults($i);
        }
        AuditLog::record('member.added_from_records', $user, ['by' => $me->id]);

        return $this->show($request, $user->id);
    }
}
