<?php
/**
 * Separate connector configuration. Most institutions don't need this: the app can read the records database
 * itself (Admin > Settings > Your records > Database). Use it only if that database can't be reached from the app's server.
 * Copy to config.php (outside the web root), fill in, and keep it readable only by the web server user.
 *
 * The connector runs on YOUR server next to YOUR database. SOS Connect never receives database
 * credentials or passwords: it only asks "is this login valid, and who is it?" over signed requests.
 */
return [
    // From SOS Connect: Admin > Settings > Sign-in connector (shown once when saved).
    'key_id' => 'k_xxxxxxxxxxxx',
    'secret' => 'paste-the-64-character-secret-here',

    // Use a READ-ONLY account limited to the tables listed at the top of the query set (queries/standard-erp.php), e.g.
    //   CREATE USER 'sos_connector'@'localhost' IDENTIFIED BY '...';
    //   GRANT SELECT ON records_db.* TO 'sos_connector'@'localhost';   (or table by table)
    'db' => [
        'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=records_db;charset=utf8mb4',
        'user' => 'sos_connector',
        'password' => '',
    ],

    // Only these source IPs may call the connector (SOS Connect's server addresses). Empty = allow all (local testing only).
    'allowed_ips' => [],

    'nonce_dir' => __DIR__ . '/storage/nonces',

    // The SQL for your records system. Copy and edit the query set if your tables are named differently.
    'queries' => require __DIR__ . '/queries/standard-erp.php',

    // students.status / staff.status values that mean "currently here"
    'active_status' => [1, '1'],

    // student_academics.studentship values that still count as a current student (1 = normal).
    // 2 deferment, 3 self-withdrawn, 4 expelled, 5 suspended are treated as not active.
    'active_studentship' => [1, '1', null],

    // student_academics.level at or above this means graduated
    'graduated_level' => 1000,

    // Roles (HOD, Dean, class rep...) are not taken from the ERP. They are given in SOS Connect: Admin > Roles / Members.

    // Send next-of-kin / guardian contacts so the institution can invite parents (only used if Parents is switched on).
    'share_guardians' => true,
];
