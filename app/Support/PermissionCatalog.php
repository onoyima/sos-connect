<?php

namespace App\Support;

/**
 * Every permission in the system. Roles are bundles of these keys; a person can also be given or denied
 * one directly.
 *
 * "area" permissions can be limited to part of the institution (a faculty, a department, an admin unit and
 * everything inside it). The others only count when given for the whole institution, because they are about
 * the institution itself (its settings, its roles, its audit log).
 *
 * "module" ties a permission to a feature switch: when the feature is off, nobody has the permission.
 */
final class PermissionCatalog
{
    public const GROUPS = [
        'chat' => ['label' => 'Chat', 'items' => [
            'chat.use' => ['label' => 'Use chat and groups', 'area' => false],
            'chat.direct' => ['label' => 'Start private chats', 'area' => false, 'module' => 'direct_chat'],
            'chat.anyone' => ['label' => 'Chat and call people without a chat request', 'area' => true, 'module' => 'direct_chat'],
            'chat.files' => ['label' => 'Send photos, voice notes and files', 'area' => false, 'module' => 'file_sharing'],
            'directory.search' => ['label' => 'Search for people', 'area' => false],
        ]],
        'groups' => ['label' => 'Communities and groups', 'items' => [
            'groups.create' => ['label' => 'Create their own groups', 'area' => false, 'module' => 'custom_groups'],
            'groups.view' => ['label' => 'See all groups in admin', 'area' => true],
            'groups.manage' => ['label' => 'Edit, switch off or rename groups', 'area' => true],
            'groups.members' => ['label' => 'Add or remove people in any group', 'area' => true],
            'groups.admins' => ['label' => 'Make people group admins', 'area' => true],
            'messages.delete' => ['label' => "Delete other people's messages", 'area' => true],
        ]],
        'announcements' => ['label' => 'Notices', 'items' => [
            'announcements.view' => ['label' => 'Read notices', 'area' => false, 'module' => 'announcements'],
            'announcements.create' => ['label' => 'Post notices', 'area' => true, 'module' => 'announcements'],
            'announcements.edit' => ['label' => 'Edit notices', 'area' => true, 'module' => 'announcements'],
            'announcements.delete' => ['label' => 'Delete notices', 'area' => true, 'module' => 'announcements'],
        ]],
        'status' => ['label' => 'Status and calls', 'items' => [
            'status.post' => ['label' => 'Post status updates', 'area' => false, 'module' => 'status'],
            'status.delete' => ['label' => "Remove other people's status updates", 'area' => true, 'module' => 'status'],
            'calls.voice' => ['label' => 'Make voice calls', 'area' => false, 'module' => 'voice_calls'],
            'calls.video' => ['label' => 'Make video calls', 'area' => false, 'module' => 'video_calls'],
        ]],
        'safety' => ['label' => 'SOS and safety', 'items' => [
            'sos.raise' => ['label' => 'Send an SOS', 'area' => false],
            'sos.view' => ['label' => 'See SOS alerts from others', 'area' => true],
            'sos.respond' => ['label' => 'Respond to SOS alerts', 'area' => true],
            'safety_checks.create' => ['label' => 'Send "Are you safe?" checks', 'area' => true, 'module' => 'safety_checks'],
            'safety_checks.results' => ['label' => 'See safety check answers', 'area' => true, 'module' => 'safety_checks'],
        ]],
        'members' => ['label' => 'Members', 'items' => [
            'members.view' => ['label' => 'View members', 'area' => true],
            'members.contact' => ['label' => "See members' phone and email", 'area' => true],
            'members.suspend' => ['label' => 'Suspend or restore members', 'area' => true],
            'members.delete' => ['label' => 'Delete members', 'area' => true],
            'members.consent' => ['label' => 'Record guardian consent for under-18s', 'area' => true],
            'parents.invite' => ['label' => 'Invite parents and guardians', 'area' => true, 'module' => 'parents'],
        ]],
        'roles' => ['label' => 'Roles and permissions', 'items' => [
            'roles.view' => ['label' => 'View roles', 'area' => false],
            'roles.create' => ['label' => 'Create roles', 'area' => false],
            'roles.edit' => ['label' => 'Edit roles and their permissions', 'area' => false],
            'roles.delete' => ['label' => 'Delete roles', 'area' => false],
            'roles.assign' => ['label' => 'Give or remove roles', 'area' => true],
            'permissions.assign' => ['label' => 'Give or remove single permissions', 'area' => true],
        ]],
        'structure' => ['label' => 'Faculties, departments and courses', 'items' => [
            'units.view' => ['label' => 'View faculties, departments and units', 'area' => false],
            'units.manage' => ['label' => 'Add or edit faculties, departments, units and courses', 'area' => true],
        ]],
        'oversight' => ['label' => 'Reports and records', 'items' => [
            'reports.view' => ['label' => 'See reported messages', 'area' => true],
            'reports.resolve' => ['label' => 'Act on reported messages', 'area' => true],
            'data_requests.view' => ['label' => 'See data protection requests', 'area' => false],
            'data_requests.handle' => ['label' => 'Answer data protection requests', 'area' => false],
            'audit.view' => ['label' => 'See the audit log', 'area' => false],
        ]],
        'institution' => ['label' => 'Institution', 'items' => [
            'settings.edit' => ['label' => 'Change institution settings', 'area' => false],
            'connector.edit' => ['label' => 'Set up the sign-in connector', 'area' => false],
            'modules.manage' => ['label' => 'Switch features on or off', 'area' => false],
        ]],
    ];

    /** @return array<string, array{label:string, area:bool, module?:string, group:string}> */
    public static function all(): array
    {
        static $flat = null;
        if ($flat === null) {
            $flat = [];
            foreach (self::GROUPS as $g => $group) {
                foreach ($group['items'] as $key => $def) {
                    $flat[$key] = $def + ['group' => $g];
                }
            }
        }

        return $flat;
    }

    public static function keys(): array
    {
        return array_keys(self::all());
    }

    public static function exists(string $key): bool
    {
        return isset(self::all()[$key]);
    }

    public static function isArea(string $key): bool
    {
        return (bool) (self::all()[$key]['area'] ?? false);
    }

    public static function module(string $key): ?string
    {
        return self::all()[$key]['module'] ?? null;
    }

    /** For the admin screens. */
    public static function forClient(): array
    {
        $out = [];
        foreach (self::GROUPS as $g => $group) {
            $out[] = ['key' => $g, 'label' => $group['label'], 'items' => array_map(
                fn ($k, $d) => ['key' => $k, 'label' => $d['label'], 'area' => $d['area'], 'module' => $d['module'] ?? null],
                array_keys($group['items']), $group['items'],
            )];
        }

        return $out;
    }
}
