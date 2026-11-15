<?php

namespace App\Support;

use App\Models\Conversation;
use App\Models\Institution;

/**
 * Feature switches. The institution's super admin (anyone with modules.manage) turns each one on or off;
 * when a feature is off, its screens, permissions and groups disappear for everyone, and come back
 * unchanged when it is switched on again (nothing is deleted).
 *
 * SOS is deliberately not in this list: it can never be switched off.
 */
final class Modules
{
    public const ALL = [
        'communities' => ['label' => 'Communities', 'description' => 'University, faculty and department communities that people join automatically.', 'default' => true],
        'general_groups' => ['label' => 'General groups', 'description' => 'One open group per community for everyone in it.', 'default' => true, 'requires' => 'communities'],
        'student_groups' => ['label' => 'Students groups', 'description' => 'Students-only groups for the university, each faculty and department.', 'default' => true, 'requires' => 'communities'],
        'staff_groups' => ['label' => 'Staff groups', 'description' => 'Staff-only groups for the university, each faculty and department.', 'default' => true, 'requires' => 'communities'],
        'level_groups' => ['label' => 'Level groups', 'description' => 'A group per level in each department, e.g. 200 Level Microbiology.', 'default' => true, 'requires' => 'communities'],
        'course_groups' => ['label' => 'Course groups', 'description' => 'A group per course for its students and lecturers.', 'default' => true, 'requires' => 'communities'],
        'admin_unit_groups' => ['label' => 'Admin unit groups', 'description' => 'Staff groups for ICT, Bursary, Registry and other non-academic units.', 'default' => true, 'requires' => 'communities'],
        'hostel_groups' => ['label' => 'Hostel groups', 'description' => 'A residents group per hostel, from the accommodation records.', 'default' => true, 'requires' => 'communities'],
        'parents' => ['label' => 'Parents and guardians', 'description' => 'Parent accounts and the parents group.', 'default' => false],
        'announcements' => ['label' => 'Notices', 'description' => 'The notices page and announcement channels.', 'default' => true],
        'direct_chat' => ['label' => 'Private chats', 'description' => 'One-to-one messages.', 'default' => true],
        'custom_groups' => ['label' => 'Groups made by members', 'description' => 'Members creating their own groups.', 'default' => true],
        'chat_requests' => ['label' => 'Chat requests', 'description' => 'People who may not message someone straight away (e.g. student to student) can send a request to chat. Off: only chats your rules allow at once.', 'default' => true, 'requires' => 'direct_chat'],
        'file_sharing' => ['label' => 'Photos and files', 'description' => 'Sending photos and documents in chat.', 'default' => true],
        'voice_notes' => ['label' => 'Voice notes', 'description' => 'Recording and sending voice notes in chat.', 'default' => true],
        'stickers' => ['label' => 'Stickers', 'description' => 'The built-in sticker set in chat. (Emojis in messages always work.)', 'default' => true],
        'status' => ['label' => 'Status', 'description' => 'Updates that disappear after 24 hours.', 'default' => true],
        'status_interactions' => ['label' => 'Status likes, comments and replies', 'description' => 'Liking, loving, commenting on and replying to status updates.', 'default' => true, 'requires' => 'status'],
        'voice_calls' => ['label' => 'Voice calls', 'description' => 'Internet and campus Wi-Fi voice calls.', 'default' => true],
        'video_calls' => ['label' => 'Video calls', 'description' => 'Internet and campus Wi-Fi video calls.', 'default' => true],
        'group_calls' => ['label' => 'Group calls', 'description' => 'Voice and video calls in group chats (voice or video calls must also be on).', 'default' => true],
        'safety_checks' => ['label' => 'Safety checks', 'description' => '"Are you safe?" checks during incidents.', 'default' => true],
        'offline_mesh' => ['label' => 'Offline messaging', 'description' => 'Chat over Bluetooth and Wi-Fi without internet in the phone app. SOS always works offline.', 'default' => true],
    ];

    /** Which switch controls each kind of automatic group. */
    public const GROUP_TYPES = [
        'community' => 'communities',
        'announcements' => 'announcements',
        'general' => 'general_groups',
        'students' => 'student_groups',
        'staff' => 'staff_groups',
        'level' => 'level_groups',
        'course' => 'course_groups',
        'unit_staff' => 'admin_unit_groups',
        'hostel' => 'hostel_groups',
        'parents' => 'parents',
    ];

    public static function enabled(?Institution $institution, string $module): bool
    {
        if (! isset(self::ALL[$module])) {
            return true;
        }
        $saved = ($institution?->settings ?? [])['modules'] ?? [];
        $on = array_key_exists($module, $saved) ? (bool) $saved[$module] : self::ALL[$module]['default'];
        $parent = self::ALL[$module]['requires'] ?? null;

        return $on && ($parent === null || self::enabled($institution, $parent));
    }

    /** @return array<string,bool> */
    public static function states(?Institution $institution): array
    {
        $out = [];
        foreach (array_keys(self::ALL) as $m) {
            $out[$m] = self::enabled($institution, $m);
        }

        return $out;
    }

    /** A conversation is hidden (not deleted) when its group type's feature is off, or an admin switched it off. */
    public static function conversationVisible(?Institution $institution, Conversation $c): bool
    {
        if (! $c->enabled) {
            return false;
        }
        if ($c->type === 'direct') {
            return self::enabled($institution, 'direct_chat');
        }
        if ($c->type === 'group') {
            return self::enabled($institution, 'custom_groups');
        }
        $module = self::GROUP_TYPES[$c->auto_type] ?? null;
        if ($module === null) {
            return true;
        }
        // Announcement channels and course groups sit inside communities.
        return self::enabled($institution, $module) && ($c->auto_type === 'parents' || self::enabled($institution, 'communities'));
    }
}
