<?php

return [

    /*
    | Platform signing key (Ed25519) used to issue device certificates. Phones verify these
    | certificates offline, so a stranger's phone can't pretend to be a member of an institution.
    | Generate with: php artisan sos:platform-keys
    */
    'platform_sign_secret' => env('SOS_PLATFORM_SIGN_SECRET'),   // base64, 64 bytes
    'platform_sign_public' => env('SOS_PLATFORM_SIGN_PUBLIC'),   // base64, 32 bytes (pinned in the mobile app)

    'certificate_days' => (int) env('SOS_CERTIFICATE_DAYS', 30),

    // Block repeated attempts (sign-in, registration, API). Empty = only in production; true/false to force.
    'rate_limits' => in_array(env('SOS_RATE_LIMITS'), [null, ''], true) ? null : filter_var(env('SOS_RATE_LIMITS'), FILTER_VALIDATE_BOOL),

    'connector' => [
        'timeout' => (int) env('SOS_CONNECTOR_TIMEOUT', 8),      // seconds
        'max_clock_skew' => 300,                                 // seconds allowed between us and the connector
        'require_https' => env('SOS_CONNECTOR_REQUIRE_HTTPS', true),


        // Direct mode: this app reads an institution's records database itself (no separate connector to run).
        // The institution admin enters the database details in Admin > Settings; they're stored encrypted.
        // Switch off on a shared host if institutions' databases must only be reached through their own connector.
        'allow_direct' => env('SOS_ALLOW_DIRECT_DB', true),
        'connect_timeout' => 5,

        // SQL sets in connector/queries/<key>.php, one per kind of records system.
        'query_sets' => [
            'standard-erp' => 'University ERP (students, staff, student_academics, course_regs, accommodation)',
        ],
    ],

    'mesh' => [
        'key_rotation_days' => (int) env('SOS_MESH_KEY_ROTATION_DAYS', 30),
        'max_envelope_bytes' => 64 * 1024,
        'default_ttl_hops' => 8,
        'sos_ttl_hops' => 16,
        'max_envelope_age_hours' => 72,
        'relay_batch_limit' => 500,
    ],

    'sos' => [
        'escalate_after_seconds' => (int) env('SOS_ESCALATE_AFTER', 120),
        'national_emergency_numbers' => [
            'NG' => ['112', '767'],      // general emergency, Lagos emergency
            'GH' => ['112'],
            'KE' => ['999', '112'],
            'ZA' => ['10111', '112'],
            'default' => ['112'],
        ],
    ],

    'status' => [
        'expiry_hours' => (int) env('SOS_STATUS_EXPIRY_HOURS', 24),
    ],

    // Where browsers and phones reach the live-update server, if not the same address as the website
    // (e.g. behind a proxy: REVERB_PUBLIC_HOST=ws.example.edu, REVERB_PUBLIC_PORT=443, REVERB_PUBLIC_SCHEME=https).
    'realtime' => [
        'public_host' => env('REVERB_PUBLIC_HOST'),
        'public_port' => env('REVERB_PUBLIC_PORT'),
        'public_scheme' => env('REVERB_PUBLIC_SCHEME'),
    ],

    'calls' => [
        // Calls between different networks (mobile data, another Wi-Fi) need a relay ("TURN") server. Either:
        //  a) your own coturn with a shared secret (docs/calls.md): TURN_HOST + TURN_SECRET (+ TURN_TLS=true if 5349 has a certificate), or
        //  b) a hosted TURN service with a fixed login: TURN_URLS (comma separated) + TURN_USERNAME + TURN_PASSWORD.
        'turn_host' => env('TURN_HOST'),
        'turn_secret' => env('TURN_SECRET'),
        'turn_tls' => (bool) env('TURN_TLS', false),
        'turn_urls' => env('TURN_URLS'),
        'turn_username' => env('TURN_USERNAME'),
        'turn_password' => env('TURN_PASSWORD'),
        'turn_ttl' => 3600,
        // Group calls connect every phone to every other one, so they stay small enough to work on campus Wi-Fi.
        'group_max' => (int) env('SOS_GROUP_CALL_MAX', 8),
        // Groups up to this size ring everyone when a call starts; bigger groups just show "Join call".
        'group_ring_limit' => (int) env('SOS_GROUP_CALL_RING_LIMIT', 50),
    ],

    'push' => [
        'expo_url' => 'https://exp.host/--/api/v2/push/send',
    ],

    /*
    | Retention (days). Applied by `php artisan sos:prune` (scheduled daily).
    | Institutions can shorten, but not lengthen, these in their settings.
    */
    'retention' => [
        'messages' => 365,
        'sos_alerts' => 730,          // kept longer for incident investigation
        'sos_locations' => 30,        // precise coordinates are blurred after 30 days
        'status_updates' => 1,
        'mesh_envelopes' => 7,
        'audit_logs' => 730,
        'call_logs' => 180,
        'inactive_accounts' => 365,   // members not seen and no longer active at the institution
    ],

    'legal' => [
        'operator_name' => env('SOS_OPERATOR_NAME', 'SOS Connect'),
        'operator_address' => env('SOS_OPERATOR_ADDRESS', '[registered address]'),
        'dpo_email' => env('SOS_DPO_EMAIL', 'dpo@example.com'),
        'policy_version' => '2026-11-09',
    ],
];
