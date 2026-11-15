# Roles, permissions and communities

## Permissions
A permission is one action, such as "View members" or "Post notices". The full list is in
`app/Support/PermissionCatalog.php`, grouped into sections (Chat, Groups, Notices, Members, Roles and so on).

Some permissions are **area** permissions: they can be limited to part of the institution (a faculty, a department,
an admin unit or a hostel, and everything inside it). The rest are about the institution itself (settings, roles,
audit log) and only count when given for the whole institution.

## Roles
A role is a named set of permissions. Every institution starts with these roles and can edit them or add its own
(Admin > Roles):

| Role | Usually given for | Main powers |
|---|---|---|
| Super admin | Whole institution | Every permission, always. The last one can't be removed. |
| Institution admin | Whole institution | Settings, connector, features, roles, members, groups, structure |
| Vice-Chancellor, Registrar | Whole institution | Institution-wide notices and safety checks, members, reports |
| Dean of Student Affairs | Whole institution | Student welfare, wardens, reports, parents |
| Dean | A faculty | Notices, members, groups and giving roles in that faculty |
| Head of department | A department | The same, in that department only |
| Head of unit | An admin unit (ICT, Bursary...) | Notices and groups for that unit |
| Security and responders, Health centre, Counsellor | Whole institution or an area | Receive and respond to SOS |
| Hall warden | A hostel | SOS, safety checks and notices for the hostel |
| Course adviser, Lecturer | A department | Notices, member list |
| Data protection officer | Whole institution | Data requests |
| Moderator | Whole institution or an area | Reported messages |
| Student, Staff, Parent | Automatic | What every member of that kind can do |

Change the Student, Staff or Parent role to change what everyone of that kind can do (for example, stop students
posting status updates).

## Giving roles and single permissions
On a member's page (Admin > Members > a person):
- **Give a role** for the whole institution or one area, optionally until a date (acting roles end on their own).
- **Add or take away a single permission** without a role. Taking a permission away beats any role.
- **What they can do** shows the result of everything together.

**You can only give what you have, where you have it.** To give a role in an area you need "Give or remove roles"
there, and every permission in that role there. An HOD can make someone a lecturer in their department, but not a
dean, and not in another department. Only a super admin can make another super admin.

Roles never come from the institution's records. The ERP's own roles tables (HOD, Dean, class rep and so on) are
ignored: every role is given in SOS Connect by someone allowed to give it, in the area where they have that right.
The records only decide who a person is and where they belong (faculty, department, level, hostel, courses).

## Communities and groups
Made automatically from the structure (Admin > Faculties and units) and joined automatically at sign-in:

```
<Institution name> (community)
├─ Announcements · General · All Students · All Staff · Parents and Guardians
├─ Faculty of Natural and Applied Sciences (community)
│  ├─ Announcements · General · Students · Staff
│  └─ Pure and Applied Physics (community)
│     ├─ Announcements · General · Students · Staff
│     ├─ 100 Level Pure and Applied Physics, 200 Level ...
│     └─ PHY 101: General Physics I ... (course groups)
└─ Administration (community)
   └─ ICT Directorate Staff · Bursary Staff · Internal Audit Staff ...
```

- People see only the communities and groups they belong to.
- Students go into students groups, staff into staff groups, everyone into general groups.
- **Announcement channels**: everyone is in them, but only people allowed to post notices for that area can write.
- Moving level or department updates groups at the next sign-in. Groups people joined by hand are never touched.

Admin > Groups shows every group in your areas: rename it, switch it off, choose who can post, add or remove people,
and **make anyone a group admin with chosen powers** (post, manage members, change settings, delete messages, make
other admins). A group admin can only pass on powers they have.

## Features (Admin > Features)
Super admins (anyone with "Switch features on or off") can turn off communities, each kind of automatic group,
parents, notices, private chats, member-made groups, file sharing, status, voice and video calls, safety checks
and offline chat. A feature that is off disappears for everyone, super admins included, and comes back unchanged
when switched on. **SOS can never be switched off.**

## Parents
Admin > Parents: invite a parent, link them to their child by matric number, and send them the one-time link to set
a password. Parents see the university community's announcements and the parents group, and can send an SOS.
