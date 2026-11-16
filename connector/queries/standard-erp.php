<?php
/**
 * Query set "standard-erp": a university ERP with the tables below. Used for sign-in, profiles and "Sync from
 * records", both by the app itself (direct mode) and by the separate connector. For a system with different
 * tables, copy this file to connector/queries/<name>.php, change the SQL, and add it to config/sos.php (query_sets).
 *
 * Tables used, all read-only:
 *   students, student_academics, student_contacts, course_studies
 *   staff, staff_work_profiles, staff_positions (job title, shown as text only)
 *   faculties, departments, admin_departments
 *   courses, course_regs, course_assigneds, assigned_courses, vu_semesters, semesters, academic_sessions, vu_sessions
 *   vuna_accomodations, vuna_accomodation_histories, vuna_acc_cate_rooms
 *
 * Facts this relies on:
 *   - the matric number is student_academics.matric_no (systems without that column use students.username);
 *     students sign in with their matric number only. students.status / staff.status = 1 means active
 *   - student_academics.studentship: 1 normal, 2 deferment, 3 self-withdrawn, 4 expelled, 5 suspended
 *   - student_academics.level >= 1000 means graduated (alumni)
 *   - faculties / departments / admin_departments.status = 1 means in use
 *   - admin_departments with academic_department_id = 0 (or null) are non-academic units (ICT, Bursary...)
 *   - a student's current semester is student_academics.vu_semester_id; the semesters in progress are the ones
 *     students are currently on
 *   - the current session is the vu_sessions row whose dates cover today (else the newest)
 *
 * Roles are NOT read from the ERP (its roles, staff_assigned_roles, role_users and student_roles tables are
 * ignored). Who is HOD, Dean, class rep and so on is decided in this app: Admin > Roles and Admin > Members.
 *
 * Named parameters can't repeat in PDO, so a value used twice is passed as :id and :id2 and so on.
 */

$currentSemesters = "(SELECT DISTINCT sa_cur.vu_semester_id FROM student_academics sa_cur WHERE sa_cur.vu_semester_id IS NOT NULL)";
$currentSession = "(SELECT COALESCE(
        (SELECT vs.id FROM vu_sessions vs WHERE CURDATE() BETWEEN vs.start_date AND vs.end_date ORDER BY vs.id DESC LIMIT 1),
        (SELECT MAX(vs2.id) FROM vu_sessions vs2)))";

$studentColumns = "
    s.id, s.email, COALESCE(sa.matric_no, s.username) AS matric, s.fname, s.mname, s.lname, s.phone, s.gender, s.dob, s.status,
    sa.level, sa.studentship, sa.vu_semester_id, sa.graduation_year,
    COALESCE(sa.faculty_id, d.faculty_id) AS faculty_id, f.name AS faculty_name, f.abb AS faculty_code,
    COALESCE(sa.department_id, cs.department_id) AS department_id, d.name AS department_name, d.abb AS department_code,
    cs.name AS programme";

$studentJoins = "
    FROM students s
    LEFT JOIN student_academics sa ON sa.student_id = s.id
    LEFT JOIN course_studies cs ON cs.id = sa.course_study_id
    LEFT JOIN departments d ON d.id = COALESCE(sa.department_id, cs.department_id)
    LEFT JOIN faculties f ON f.id = COALESCE(sa.faculty_id, d.faculty_id)";

$staffColumns = "
    st.id, st.email, st.fname, st.mname, st.lname, st.phone, st.gender, st.dob, st.status,
    swp.staff_no, swp.faculty_id, f.name AS faculty_name, f.abb AS faculty_code,
    swp.department_id, d.name AS department_name, d.abb AS department_code,
    swp.admin_department_id, ad.name AS admin_department_name, ad.academic_department_id,
    sp.name AS position";

$staffJoins = "
    FROM staff st
    LEFT JOIN staff_work_profiles swp ON swp.staff_id = st.id
    LEFT JOIN faculties f ON f.id = swp.faculty_id
    LEFT JOIN departments d ON d.id = swp.department_id
    LEFT JOIN admin_departments ad ON ad.id = swp.admin_department_id
    LEFT JOIN staff_positions sp ON sp.id = swp.staff_position_id";

return [
    // Students sign in with their matric number only. Returns the password hash to check; it never leaves the connector.
    'student_by_login' => "SELECT {$studentColumns}, s.password {$studentJoins}
        WHERE sa.matric_no = :login OR (sa.matric_no IS NULL AND s.username = :login2)
        ORDER BY sa.id DESC LIMIT 1",

    // Staff sign in by email or staff number.
    'staff_by_login' => "SELECT {$staffColumns}, st.password {$staffJoins}
        WHERE st.email = :login OR swp.staff_no = :login2 LIMIT 1",

    'student_by_id' => "SELECT {$studentColumns} {$studentJoins} WHERE s.id = :id LIMIT 1",
    'staff_by_id' => "SELECT {$staffColumns} {$staffJoins} WHERE st.id = :id LIMIT 1",

    // Students and alumni looking for each other (by name or matric number), including people who have never
    // signed in to SOS Connect. Whether each one may be reached is decided from their record (active, graduated…).
    'student_search' => "SELECT {$studentColumns} {$studentJoins}
        WHERE CONCAT_WS(' ', s.fname, s.mname, s.lname) LIKE :q OR CONCAT_WS(' ', s.lname, s.fname) LIKE :q2 OR sa.matric_no LIKE :q3
        ORDER BY s.lname, s.fname LIMIT 20",

    // Staff looking for another staff member (by name, staff number or email), including people who have never
    // signed in to SOS Connect. Active staff only.
    'staff_search' => "SELECT {$staffColumns} {$staffJoins}
        WHERE st.status = 1 AND (CONCAT_WS(' ', st.fname, st.mname, st.lname) LIKE :q OR CONCAT_WS(' ', st.lname, st.fname) LIKE :q2
            OR swp.staff_no LIKE :q3 OR st.email LIKE :q4)
        ORDER BY st.lname, st.fname LIMIT 20",

    // Courses the student registered for in their current semester -> id, code, title, level, department_id
    'student_courses' => "SELECT DISTINCT c.id, c.code, c.title, c.level, c.department_id
        FROM course_regs r JOIN courses c ON c.id = r.course_id
        WHERE r.student_id = :id
          AND r.vu_semester_id = COALESCE(
              (SELECT sa.vu_semester_id FROM student_academics sa WHERE sa.student_id = :id2 LIMIT 1),
              (SELECT MAX(r2.vu_semester_id) FROM course_regs r2 WHERE r2.student_id = :id3))",

    // Courses the lecturer is assigned this semester -> id, code, title, level, department_id
    'staff_courses' => "SELECT DISTINCT c.id, c.code, c.title, c.level, c.department_id
        FROM course_assigneds a JOIN courses c ON c.id = a.course_id
        WHERE a.staff_id = :id AND a.vu_semester_id IN {$currentSemesters}
        UNION
        SELECT DISTINCT c.id, c.code, c.title, c.level, c.department_id
        FROM assigned_courses ac JOIN courses c ON c.id = ac.course_id
        WHERE ac.staff_id = :id2 AND ac.vu_semester_id IN {$currentSemesters}",


    // Where the student lives this session -> hostel_id, hostel_name, room
    'student_hostel' => "SELECT a.id AS hostel_id, a.name AS hostel_name, rm.room_no AS room
        FROM vuna_accomodation_histories h
        JOIN vuna_accomodations a ON a.id = h.vuna_accomodation_id AND a.deleted_at IS NULL
        LEFT JOIN vuna_acc_cate_rooms rm ON rm.id = h.vuna_acc_cate_room_id
        WHERE h.student_id = :id AND h.vu_session_id = {$currentSession}
        ORDER BY h.id DESC LIMIT 1",

    // Parents / guardians / next of kin -> name, relationship, phone, email
    'student_guardians' => "SELECT TRIM(CONCAT_WS(' ', sc.title, sc.other_names, sc.surname)) AS name, sc.relationship,
            COALESCE(NULLIF(sc.phone_no, ''), sc.phone_no_two) AS phone, COALESCE(NULLIF(sc.email, ''), sc.email_two) AS email
        FROM student_contacts sc WHERE sc.student_id = :id",

    // The whole structure -> type, id, name, code, parent_id
    'org_units' => "
        SELECT 'faculty' AS type, id, name, abb AS code, NULL AS parent_id FROM faculties WHERE status = 1
        UNION ALL SELECT 'department', id, name, abb, faculty_id FROM departments WHERE status = 1
        UNION ALL SELECT 'admin_department', id, name, NULL, NULL FROM admin_departments
            WHERE status = 1 AND (academic_department_id = 0 OR academic_department_id IS NULL)
        UNION ALL SELECT 'hostel', id, name, NULL, NULL FROM vuna_accomodations WHERE deleted_at IS NULL",

    // Every course -> id, code, title, level, semester, department_id
    'courses' => "SELECT c.id, c.code, c.title, c.level, c.semester_offered AS semester, c.department_id
        FROM courses c JOIN departments d ON d.id = c.department_id AND d.status = 1",

    // The session and semester in progress, for display -> session, semester
    'current_session' => "SELECT vs.session, sm.semester
        FROM vu_sessions vs
        LEFT JOIN academic_sessions acs ON acs.vu_session_id = vs.id
        LEFT JOIN vu_semesters vsm ON vsm.academic_session_id = acs.id AND vsm.id IN {$currentSemesters}
        LEFT JOIN semesters sm ON sm.id = vsm.semester_id
        WHERE vs.id = {$currentSession} ORDER BY vsm.id DESC LIMIT 1",
];
