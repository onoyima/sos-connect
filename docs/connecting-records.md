# Connecting an institution's records

The app never keeps a bulk copy of an institution's students and staff. It reads their records system only when
it needs to:

| When | What is read |
|---|---|
| Someone signs in | That one person: login check, name, faculty, department, level, programme, hostel and room, courses this semester, guardians (if Parents is on). Their account is created the first time and updated every sign-in. |
| An admin presses **Sync from records** (Admin → Structure) | The list of faculties, departments, admin departments, hostels and courses, so groups exist before people sign in. New and renamed items come in; nothing is deleted. |
| Every night, if **automatic sync** is on (Admin → Settings → Sign-in) | The same as Sync from records. Needs the scheduler: `php artisan schedule:work` locally, a cron entry in production. |

So when the institution adds a department, a course or a hostel, it appears here on the next sync (or when the
first person from it signs in). There is nothing to migrate or seed.

## Two ways to connect (Admin → Settings → Your records)

**Database** (simplest): enter the records database host, port, name and a read-only username and password. They
are stored encrypted. The app reads the database itself, so nothing else has to run. A server operator can switch
this off with `SOS_ALLOW_DIRECT_DB=false` if institutions must only be reached through their own connector.

**Separate connector**: for a database that can't be reached from the app's server. Deploy `connector/` on the
institution's network (see `connector/config.example.php`), then enter its HTTPS address. Requests and answers are
signed both ways.

Both use the same code (`connector/src/Directory.php`) and the same SQL.

## Records systems (query sets)

The SQL that describes a records system lives in `connector/queries/<name>.php` and is listed in
`config/sos.php` → `connector.query_sets`. `standard-erp` covers a university ERP with tables such as `students`,
`student_academics`, `course_regs`, `staff`, `staff_work_profiles`, `faculties`, `departments`,
`admin_departments` and the accommodation tables (the header of the file lists everything it reads and the
meaning of each status value). For a different system, copy the file, change the SQL, and add it to the list.

Roles are never read from the records. Who is HOD, Dean, class rep and so on is decided in this app
(Admin → Roles, Admin → Members).

## Sign-in

There is one sign-in form and no public list of institutions. The institution is worked out from what the person
types: their email domain, or their matric or staff number format (Admin → Settings → Sign-in; `*` = anything,
`#` = one digit). Wrong details, an unknown institution or one that isn't active all get the same message.
If the service has only one institution, everyone is checked against it.
