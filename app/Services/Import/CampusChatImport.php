<?php

namespace App\Services\Import;

use App\Models\Announcement;
use App\Models\Conversation;
use App\Models\ConversationMember;
use App\Models\Institution;
use App\Models\Message;
use App\Models\OrgUnit;
use App\Models\User;
use App\Services\Groups\AutoGroupSync;
use App\Support\CurrentInstitution;
use Illuminate\Database\Connection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Brings people, chats, groups, messages and announcements across from the previous campus chat system
 * (its comm_* tables). Safe to run more than once: everything brought in is remembered in import_links and
 * skipped the next time, so it can be re-run to pick up messages written since.
 *
 *   comm_chat_identities  -> users (student "st-<id>", staff "sf-<id>", same ids the records use)
 *   comm_conversations    -> DIRECT: private chats; GROUP + scope PRIVATE: member-made groups (with their members);
 *                            GROUP + university/faculty/department/level scopes: the matching standing groups here
 *                            (members of those come from the records when people sign in)
 *   comm_messages         -> messages (text as is; photos, voice notes and files become a note with a link to the
 *                            original file, because the files stay on the old server)
 *   comm_announcements    -> notices for everyone
 * Status updates, reactions, polls and read receipts are not brought across.
 */
class CampusChatImport
{
    public const SOURCE = 'campus-chat';

    private array $links = [];
    private array $counts = ['people' => 0, 'private_chats' => 0, 'groups' => 0, 'standing_groups' => 0, 'messages' => 0, 'announcements' => 0, 'skipped_messages' => 0];

    public function __construct(private readonly AutoGroupSync $groups) {}

    /**
     * @param  string|null  $filesBaseUrl  where the old server served /uploads/... (to turn old file paths into links)
     * @param  callable|null  $progress  fn(string $line)
     */
    public function run(Institution $institution, Connection $old, ?string $filesBaseUrl = null, bool $dryRun = false, ?callable $progress = null): array
    {
        $say = $progress ?? fn () => null;
        CurrentInstitution::as($institution->id, function () use ($institution, $old, $filesBaseUrl, $dryRun, $say) {
            $this->loadLinks($institution);

            $people = $this->importPeople($institution, $old, $dryRun);
            $say("People: {$this->counts['people']} new.");
            $chats = $this->importConversations($institution, $old, $people, $dryRun);
            $say("Chats: {$this->counts['private_chats']} private, {$this->counts['groups']} groups, {$this->counts['standing_groups']} standing groups matched.");
            $this->importMessages($institution, $old, $people, $chats, $filesBaseUrl, $dryRun, $say);
            $say("Messages: {$this->counts['messages']} new, {$this->counts['skipped_messages']} skipped (sender or chat not found).");
            $this->importAnnouncements($institution, $old, $people, $dryRun);
            $say("Notices: {$this->counts['announcements']} new.");
        });

        return $this->counts;
    }

    // ---- people ---------------------------------------------------------------------------------

    /** @return array<int,int> old identity id => user id */
    private function importPeople(Institution $institution, Connection $old, bool $dryRun): array
    {
        $map = [];
        $units = OrgUnit::whereNotNull('external_id')->get(['id', 'type', 'external_id'])->groupBy('type')->map(fn ($g) => $g->pluck('id', 'external_id'));

        $old->table('comm_chat_identities')->orderBy('id')->chunk(500, function ($rows) use (&$map, $institution, $units, $dryRun) {
            foreach ($rows as $r) {
                $type = strtolower((string) $r->entity_type) === 'staff' ? 'staff' : 'student';
                $external = ($type === 'staff' ? 'sf-' : 'st-').$r->entity_id;
                $linked = $this->link('identity', $r->id);
                $user = $linked ? User::find($linked) : User::inInstitution($institution->id)->where('external_id', $external)->first();
                if (! $user && ! $dryRun) {
                    $dept = $r->department_id ? ($units['department'][(string) $r->department_id] ?? null) : null;
                    $adminUnit = $r->department_id && ! $dept ? ($units['admin_department'][(string) $r->department_id] ?? null) : null;
                    $user = User::create([
                        'institution_id' => $institution->id, 'external_id' => $external, 'auth_source' => 'connector', 'member_type' => $type,
                        'name' => mb_substr((string) $r->display_name, 0, 190) ?: 'Former member', 'email' => $this->freeEmail($institution, $r->email),
                        'status' => 'active', 'department_unit_id' => $dept, 'admin_unit_id' => $adminUnit, 'faculty_unit_id' => $r->faculty_id ? ($units['faculty'][(string) $r->faculty_id] ?? null) : null,
                    ]);
                    $this->counts['people']++;
                } elseif (! $user) {
                    $this->counts['people']++;
                }
                if ($user) {
                    $map[$r->id] = $user->id;
                    if (! $linked && ! $dryRun) {
                        $this->remember($institution, 'identity', $r->id, $user->id);
                    }
                }
            }
        });

        return $map;
    }

    // ---- conversations --------------------------------------------------------------------------

    /** @return array<int,int> old conversation id => conversation id */
    private function importConversations(Institution $institution, Connection $old, array $people, bool $dryRun): array
    {
        $map = [];
        $participants = $old->table('comm_participants')->get()->groupBy('conversation_id');

        foreach ($old->table('comm_conversations')->orderBy('id')->cursor() as $c) {
            if ($linked = $this->link('conversation', $c->id)) {
                $map[$c->id] = $linked;

                continue;
            }
            $members = collect($participants[$c->id] ?? [])->filter(fn ($p) => isset($people[$p->identity_id]));
            $conversation = null;
            $handled = false;

            if (strtoupper((string) $c->type) === 'DIRECT') {
                $ids = $members->pluck('identity_id')->map(fn ($i) => $people[$i])->unique()->values();
                if ($ids->count() !== 2) {
                    continue; // one side never existed or was removed
                }
                if (! $dryRun) {
                    $conversation = Conversation::firstOrCreate(['direct_key' => Conversation::directKey($ids[0], $ids[1])], ['type' => 'direct', 'created_by' => $ids[0]]);
                    foreach ($ids as $uid) {
                        ConversationMember::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $uid], ['joined_at' => $this->date($c->created_at)]);
                    }
                }
                $this->counts['private_chats']++;
                $handled = true;
            } elseif ($key = $this->standingKey(strtolower((string) $c->scope), $c)) {
                // An automatic group of the old system: its history goes into the matching standing group here.
                $conversation = $dryRun ? null : $this->groups->groupForKey($institution, $key);
                if ($conversation || $dryRun) {
                    $this->counts['standing_groups']++;
                    $handled = true;
                }
            }

            if (! $handled) {
                // A group people made themselves (or an old automatic group with no match here): kept with its members.
                if (! $dryRun) {
                    $admin = $members->first(fn ($p) => strtolower((string) $p->role) === 'admin');
                    $conversation = Conversation::create(['type' => 'group', 'name' => mb_substr((string) ($c->name ?: 'Group'), 0, 120),
                        'description' => 'Brought across from the previous chat system.', 'created_by' => $admin ? $people[$admin->identity_id] : null]);
                    foreach ($members as $p) {
                        ConversationMember::firstOrCreate(['conversation_id' => $conversation->id, 'user_id' => $people[$p->identity_id]],
                            ['role' => strtolower((string) $p->role) === 'admin' ? 'admin' : 'member', 'joined_at' => $this->date($p->joined_at)]);
                    }
                }
                $this->counts['groups']++;
            }

            if ($conversation) {
                $map[$c->id] = $conversation->id;
                $this->remember($institution, 'conversation', $c->id, $conversation->id);
            }
        }

        return $map;
    }

    /** The old system's automatic groups, matched to the standing groups here. Null = no match. */
    private function standingKey(string $scope, object $c): ?string
    {
        $name = mb_strtolower((string) $c->name);
        $unit = fn (string $type) => $c->reference_id ? OrgUnit::where('type', $type)->where('external_id', (string) $c->reference_id)->value('id') : null;

        return match ($scope) {
            'university' => 'inst:general',
            'global' => str_contains($name, 'academic') || str_contains($name, 'admin') ? null
                : (str_contains($name, 'student') ? 'inst:students' : (str_contains($name, 'staff') ? 'inst:staff' : null)),
            'faculty' => ($u = $unit('faculty')) ? "fac:{$u}:general" : null,
            'faculty_student' => ($u = $unit('faculty')) ? "fac:{$u}:students" : null,
            'faculty_staff' => ($u = $unit('faculty')) ? "fac:{$u}:staff" : null,
            'department' => ($u = $unit('department')) ? "dept:{$u}:general" : null,
            'department_student' => ($u = $unit('department')) ? "dept:{$u}:students" : null,
            'department_staff' => ($u = $unit('department')) ? "dept:{$u}:staff" : null,
            'admin_department', 'admin_department_staff' => ($u = $unit('admin_department')) ? "unit:{$u}:staff" : null,
            'level' => ($u = $unit('department')) && preg_match('/(\d{3})\s*level/i', (string) $c->name, $m) ? "dept:{$u}:level:{$m[1]}" : null,
            default => null,
        };
    }

    // ---- messages -------------------------------------------------------------------------------

    private function importMessages(Institution $institution, Connection $old, array $people, array $chats, ?string $filesBaseUrl, bool $dryRun, callable $say): void
    {
        $after = (int) ($this->links['message:last'] ?? 0); // resume after the last message brought in
        $old->table('comm_messages')->where('id', '>', $after)->chunkById(1000, function ($rows) use ($institution, $people, $chats, $filesBaseUrl, $dryRun, $say) {
            $last = [];
            foreach ($rows as $r) {
                $conversationId = $chats[$r->conversation_id] ?? null;
                $sender = $people[$r->sender_identity_id] ?? null;
                if (! $conversationId || ! $sender) {
                    $this->counts['skipped_messages']++;

                    continue;
                }
                $this->counts['messages']++;
                if ($dryRun) {
                    continue;
                }
                [$body, $meta] = $this->content($r, $filesBaseUrl);
                $at = $this->date($r->created_at);
                $message = Message::firstOrCreate(['sender_id' => $sender, 'client_id' => $this->uuidFor($r->id)], [
                    'institution_id' => $institution->id, 'conversation_id' => $conversationId, 'type' => 'text', 'body' => $body,
                    'meta' => $meta, 'via' => 'online', 'sent_at' => $at, 'edited_at' => $r->is_edited ? $at : null,
                ]);
                $last[$conversationId] = [$message->id, $at];
            }
            if (! $dryRun && $rows->isNotEmpty()) {
                foreach ($last as $cid => [$mid, $at]) {
                    Conversation::whereKey($cid)->where(fn ($q) => $q->whereNull('last_message_at')->orWhere('last_message_at', '<', $at))->update(['last_message_at' => $at]);
                    // History brought across is already read.
                    ConversationMember::where('conversation_id', $cid)->where(fn ($q) => $q->whereNull('last_read_message_id')->orWhere('last_read_message_id', '<', $mid))
                        ->update(['last_read_message_id' => $mid]);
                }
                $this->remember($institution, 'message', 'last', $rows->last()->id);
                $say("  … up to old message {$rows->last()->id}");
            }
        });
    }

    /** @return array{0: string, 1: array} */
    private function content(object $r, ?string $filesBaseUrl): array
    {
        $type = strtolower((string) $r->type);
        $meta = ['imported' => self::SOURCE];
        $data = is_string($r->metadata) ? json_decode($r->metadata, true) : (array) ($r->metadata ?? []);
        $url = $data['url'] ?? $data['fileUrl'] ?? $data['mediaUrl'] ?? null;
        if ($url && ! preg_match('#^https?://#', $url) && $filesBaseUrl) {
            $url = rtrim($filesBaseUrl, '/').'/'.ltrim($url, '/');
        }
        if ($url && preg_match('#^https?://#', $url)) {
            $meta['legacy_url'] = $url;
        }
        $text = trim((string) $r->content);
        $body = match ($type) {
            'image' => 'Photo'.($text && ! in_array(mb_strtolower($text), ['image', 'photo'], true) ? ": {$text}" : ''),
            'video' => 'Video'.($text && mb_strtolower($text) !== 'video' ? ": {$text}" : ''),
            'voice_note', 'audio' => 'Voice note',
            'file' => 'File: '.($data['fileName'] ?? $data['name'] ?? ($text ?: 'attachment')),
            default => $text,
        };

        return [$body === '' ? '(empty message)' : mb_substr($body, 0, 4000), $meta];
    }

    // ---- announcements ----------------------------------------------------------------------------

    private function importAnnouncements(Institution $institution, Connection $old, array $people, bool $dryRun): void
    {
        if (! $old->getSchemaBuilder()->hasTable('comm_announcements')) {
            return;
        }
        foreach ($old->table('comm_announcements')->orderBy('id')->cursor() as $a) {
            if ($this->link('announcement', $a->id) || ! isset($people[$a->author_identity_id])) {
                continue;
            }
            $this->counts['announcements']++;
            if ($dryRun) {
                continue;
            }
            $n = Announcement::create(['institution_id' => $institution->id, 'author_id' => $people[$a->author_identity_id], 'title' => mb_substr((string) $a->title, 0, 250),
                'body' => (string) $a->content, 'audience' => ['type' => 'all'], 'priority' => $a->is_featured ? 'urgent' : 'normal', 'published_at' => $this->date($a->created_at)]);
            $this->remember($institution, 'announcement', $a->id, $n->id);
        }
    }

    // ---- bookkeeping ------------------------------------------------------------------------------

    private function loadLinks(Institution $institution): void
    {
        DB::table('import_links')->where('institution_id', $institution->id)->where('source', self::SOURCE)->orderBy('id')
            ->each(function ($l) { $this->links[$l->kind.':'.$l->legacy_id] = (int) $l->local_id; });
    }

    private function link(string $kind, int|string $legacyId): ?int
    {
        return $this->links[$kind.':'.$legacyId] ?? null;
    }

    private function remember(Institution $institution, string $kind, int|string $legacyId, int $localId): void
    {
        DB::table('import_links')->updateOrInsert(
            ['institution_id' => $institution->id, 'source' => self::SOURCE, 'kind' => $kind, 'legacy_id' => (string) $legacyId],
            ['local_id' => $localId, 'updated_at' => now(), 'created_at' => now()],
        );
        $this->links[$kind.':'.$legacyId] = $localId;
    }

    /** Emails are unique per institution; if the address is already someone else's here, leave it off. */
    private function freeEmail(Institution $institution, ?string $email): ?string
    {
        $email = $email ? mb_strtolower(trim($email)) : null;

        return $email && ! User::inInstitution($institution->id)->where('email', $email)->exists() ? $email : null;
    }

    /** The same old message always gets the same id here, so it's never stored twice. */
    private function uuidFor(int $legacyId): string
    {
        $h = md5(self::SOURCE.':message:'.$legacyId);

        return sprintf('%s-%s-4%s-a%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 13, 3), substr($h, 17, 3), substr($h, 20, 12));
    }

    private function date(mixed $value): Carbon
    {
        try {
            return $value ? Carbon::parse($value) : now();
        } catch (\Throwable) {
            return now();
        }
    }
}
