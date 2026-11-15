# SOS Connect: system design

*Architecture, development process, security model and the reasons behind each decision.*

This document explains how SOS Connect is built and why. It is written so that anyone presenting or defending the system (to examiners, an institution's ICT unit, auditors or other engineers) can answer questions about any part of it with evidence. The last section gathers the questions people usually ask.

---

## 1. What the system is for

SOS Connect is a communication and safety platform for tertiary institutions (universities, polytechnics, colleges). One deployment serves many institutions ("tenants"). For each institution it provides:

| Area | What people get |
| --- | --- |
| Messaging | One-to-one chats, groups, automatic communities (university, faculty, department, level, course, hostel, admin unit, alumni), voice notes, stickers, replies, mentions, search |
| Calls | Voice and video calls, group calls (mesh WebRTC), ringing on web and phone, missed-call counts |
| Safety | SOS button (online and offline), responders, "Are you safe?" checks, institution notices, pop-ups and marquee messages |
| Status | 24-hour updates (text, photo, GIF, video, audio) with chosen audiences, likes, comments and private replies |
| Identity | Sign-in with the institution's own records (matric number or staff ID), single phone and single browser per account, QR linking of the browser to the phone, guided face capture with liveness checks |
| Administration | Roles and permissions scoped to faculties/departments/units, feature switches, member management, guardian consent, audit log, reports, face data export, help pages |

**The defining requirement:** it must keep working when the internet does not. On campuses with unreliable data, the phone app passes messages and SOS alerts phone-to-phone over Bluetooth and Wi-Fi, and the first phone to find internet delivers everything it carried.

---

## 2. Architecture overview

```
 ┌────────────────────┐      HTTPS (JSON)       ┌──────────────────────────────────────────┐
 │  Web app (React)   │ ───────────────────────▶│  Laravel 12 application                   │
 │  Inertia pages     │◀─────── WebSocket ──────│  ├─ HTTP: web pages (Inertia) + /api      │
 └────────────────────┘        (Reverb)         │  ├─ Services (chat, SOS, mesh, faces…)    │
                                                │  ├─ Queue workers (push, exports)         │
 ┌────────────────────┐      HTTPS (JSON)       │  └─ Scheduler (retention, sync, keys)     │
 │  Phone app (Expo / │ ───────────────────────▶│                                           │
 │  React Native)     │◀─────── WebSocket ──────└───────────────┬───────────────────────────┘
 │  SQLite offline DB │                                         │
 └───────┬────────────┘                         ┌───────────────▼───────────┐  ┌──────────────────┐
         │ Bluetooth / Wi-Fi Direct / LAN       │ MySQL (one schema,        │  │ Institution's     │
 ┌───────▼────────────┐                         │ every row tagged with     │  │ records database  │
 │  Other phones,     │                         │ institution_id)           │  │ (read-only, via   │
 │  edge nodes        │                         └───────────────────────────┘  │ connector)        │
 └────────────────────┘                                                         └──────────────────┘
```

### 2.1 Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Server | PHP 8.2+, Laravel 12 | Business rules, API, authentication, authorisation, persistence, scheduling |
| Web client | React 19 + TypeScript, Inertia.js, Tailwind CSS, Vite | Browser interface (chat, calls, status, admin) without a separate API-client layer |
| Phone app | Expo (React Native) dev client, TypeScript, expo-sqlite | Offline-first client; local database, outbox, mesh networking, calls, push |
| Mesh module | Kotlin (Google Nearby Connections, P2P_CLUSTER) and Swift (MultipeerConnectivity) | Phone-to-phone transport over Bluetooth and peer-to-peer Wi-Fi |
| Realtime | Laravel Reverb (WebSocket, Pusher protocol), private channels | Instant delivery of messages, call signals, notices |
| Records connector | Plain PHP + PDO (`connector/`) | Reads the institution's own records to verify sign-in and fetch profiles; runs inside the app ("direct") or as a separate signed service |
| Edge node | Node.js (`edge-node/`) | Optional relay on a campus access point; stores and forwards mesh envelopes |
| Database | MySQL / MariaDB (SQLite in tests) | Single schema, tenant column on every tenant table |

### 2.2 Architectural style

* **Modular monolith.** One deployable Laravel application, organised into services by domain (`app/Services/Chat`, `Sos`, `Mesh`, `Faces`, `Auth`, `Access`…). For a system of this size this gives the simplicity of one codebase, one transaction boundary and one deployment, while the service classes keep domains separate enough to be split out later if a part ever needs to scale independently.
* **Server-driven UI on the web (Inertia).** Pages are React components, but routing, authorisation and data loading happen on the server. There is no duplicated route table or token handling in the browser, and every page is authorised by the same middleware as the API.
* **Offline-first on the phone.** The phone writes to its local SQLite database and an outbox first, then syncs. The interface never waits on the network; delta sync (`/api/sync?cursor=`) keeps data use low.
* **Event-driven realtime with a fallback.** Every change raises an event broadcast over Reverb. If the WebSocket is blocked, clients poll a single cheap endpoint (`/api/pulse`) that returns a cursor and recent per-user signals, so nothing depends on WebSockets alone.

### 2.3 Request lifecycle (web or API)

1. **TrustProxies**: real client IP behind load balancers.
2. **Session / Sanctum**: identifies the user (browser cookie or the phone's personal access token).
3. **EnsureActiveMember**: account active, institution active, one browser per account, sets the **tenant scope** for the rest of the request (before route-model binding, so `{conversation}` can never load another institution's row).
4. **EnsurePermission** (`can.do:…`): role-based check, including feature switches.
5. **Controller → Service**: business rules (for example ContactPolicy decides who may message whom).
6. **Events**: broadcast to the right private channels; push notifications queued.
7. **Response**: JSON or an Inertia page; `Cache-Control: no-store` for signed-in content; security headers.

---

## 3. Software development life cycle

### 3.1 Model used: iterative and incremental (Agile), with continuous delivery

The project was built in short iterations, each delivering a complete, usable slice (for example "chat requests", "group calls", "face capture"), rather than in one long waterfall. This model was chosen because:

* **Requirements came from real use.** The institution's needs (matric-number sign-in, alumni groups, under-18 consent, pop-ups, face capture) emerged and were refined as people used each increment. Waterfall assumes requirements are fixed up front; here they were not.
* **Risk is reduced early.** The riskiest parts (offline mesh, records integration, multi-tenancy) were built and tested first, so problems surfaced while they were cheap to fix.
* **Every increment is shippable.** Each iteration ends with a build, automated tests, a migration and delivery to the running system. Feature switches (Admin > Features) let new features ship switched off and be enabled per institution when ready.

### 3.2 Each iteration

| Phase | What happens | Evidence in the repository |
| --- | --- | --- |
| Requirements | User story with acceptance criteria (who, what, why; what must never happen) | Comments at the top of each controller/service describe the rules |
| Design | Data model, permissions, failure modes, security review | Migrations with explanatory headers; this document |
| Implementation | Server, web and phone together, so the feature works end to end | `app/`, `resources/js/`, `mobile/` |
| Verification | Automated feature tests (PHPUnit), type checking (TypeScript `tsc`), phone unit tests (Jest), rendered-page checks at phone, tablet and desktop widths | `tests/Feature/*`, `mobile/__tests__/*` |
| Release | Migrations are additive and backwards-compatible; built assets versioned by hash | `database/migrations/*`, `public/build/manifest.json` |
| Feedback | Test runs and live use feed the next iteration (bugs found in use become regression tests) | e.g. tests added after the `client_id` length and validation-key issues |

### 3.3 Quality practices

* **Tests as specification.** Feature tests describe behaviour in plain language (`test_under_18s_need_guardian_consent`, `test_a_member_cannot_read_another_institutions_conversation`). They run against an in-memory SQLite database in seconds.
* **Regression first.** When a defect is found, a test that reproduces it is added before (or with) the fix.
* **Type safety.** TypeScript strict mode on web and phone; shared payload types (`resources/js/types.ts`).
* **Additive migrations.** Columns are added, not renamed or removed, so an older phone app keeps working against a newer server.
* **Configuration over code.** Institution differences (records schema, ID formats, features, roles) are data, not branches in code. No institution name is hard-coded anywhere.

---

## 4. Multi-tenancy

* **Single database, tenant column.** Every tenant table has `institution_id`. The `BelongsToInstitution` trait adds a global scope to every query and stamps new rows.
* **Fails closed.** If no institution is set for the current request, scoped queries return *nothing* (`WHERE 1 = 0`) rather than everything. A forgotten scope therefore shows an empty page instead of leaking data.
* **Set before binding.** The tenant is set by middleware placed before route-model binding, so URL ids from another institution return 404.
* **Proven by tests.** `TenantIsolationTest` checks that conversations, messages and directory search never cross institutions.

Why not one database per institution? A single schema keeps migrations, backups and reporting simple for an operator running many institutions, and the fail-closed scope gives the isolation guarantee. A very large institution could still be moved to its own deployment because nothing assumes a shared database.

---

## 5. Identity and authentication

### 5.1 Sign-in against the institution's records

* Students sign in with **matric number + portal password**; staff with staff email or staff number. The institution is worked out from the identifier format or email domain; there is no public list of institutions.
* The password is checked **against the institution's own records** (direct read-only database connection, or the separately deployed connector over HMAC-signed HTTPS). **SOS Connect never stores institution passwords.**
* Failed sign-ins return one generic message (no "user not found" versus "wrong password"), and are rate-limited per IP and identifier.
* The records connection refuses to point at SOS Connect's own database, tolerates missing columns or tables in different records systems, and is read-only.
* Graduates (level 1000 and above in the records) become alumni and join alumni groups instead of being locked out.

### 5.2 Sessions and devices

* **Phone:** Laravel Sanctum personal access token (30-day expiry), stored in the phone's secure keychain.
* **Browser:** session cookie (HttpOnly, SameSite, CSRF-protected).
* **One phone and one browser per account.** A new phone sign-in deletes older phone tokens; a new browser sign-in replaces the recorded browser session, and the old one is signed out on its next request (and immediately through a realtime signal). The person is told why.
* **QR linking (phone is the main device).** The sign-in page shows a QR code (a one-minute code); the phone app scans it and approves. Only the browser that requested the code can use the approval, because it holds a secret key that is never shown on screen. Admin accounts cannot link this way; they sign in with a password.
* **Sign-out** asks for confirmation; signing out of the phone also signs out a browser linked from it.

---

## 6. Authorisation (RBAC with areas)

* **Permissions** are fine-grained keys (`chat.direct`, `announcements.create`, `faces.export`…), defined in `PermissionCatalog`.
* **Roles** bundle permissions (Super admin, Institution admin, Registrar, Dean, HOD, Lecturer, Student, Staff…). Institutions can edit roles and create their own.
* **Areas.** Many permissions are given *over an area*: a faculty, department or admin unit and everything inside it. A HOD's powers stop at their department; a Dean's cover the faculty.
* **Deny beats grant.** A person can be denied a permission directly even if a role gives it.
* **Delegation rule.** You can only give roles you could exercise yourself in that area. The last super admin cannot be removed.
* **Feature switches** (`Modules`) are checked inside the permission check, so a switched-off feature is unavailable to everyone, including super admins, and comes back unchanged when switched on.
* **Contact policy.** Who may message or call whom: staff → students directly; staff → staff in the same unit directly, otherwise by request; students → anyone by chat request; people with "chat and call without a request" over the target's area directly. Calls follow the same rule.
* **Roles are private.** People never see other people's roles or titles (admin, HOD, dean…); only the holder sees their own. In a group, members only see who the *group* admins are.

---

## 7. Security architecture

### 7.1 Principles

Defence in depth · least privilege · fail closed · secure by default (new features ship switched off where they carry risk) · privacy by design (data minimisation, retention, consent) · everything sensitive audited.

### 7.2 Controls by layer

| Layer | Controls |
| --- | --- |
| Transport | HTTPS (HSTS when served over TLS); camera features require a secure context; the separate connector requires HTTPS and HMAC-signed requests with timestamp and nonce (replay protection) |
| Authentication | Records-backed passwords (never stored), rate limiting, generic errors, single phone and browser, QR linking with a hidden browser key, token expiry, immediate revocation on suspension |
| Session | HttpOnly cookies, CSRF tokens (419 handled gracefully), session regeneration on sign-in, `no-store` caching for signed-in pages, Back-button guard after sign-out |
| Authorisation | RBAC with areas, deny-overrides, feature switches, per-object checks (membership, area) on every endpoint |
| Tenant isolation | Global scope that fails closed; tenant set before route binding |
| Input | Server-side validation on every field; every key of a checked array has its own rule; file type detected from the bytes (not the name), allow-listed types and sizes; random file names; private storage |
| Data at rest | Message bodies encrypted with the application key (`encrypted` cast); records-database credentials and connector secrets encrypted; face photos encrypted on disk; exports AES-256 encrypted with an admin-chosen password |
| Output | React escapes by default; Markdown rendered server-side with HTML input escaped and unsafe links blocked; `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| Offline mesh | Every envelope signed (Ed25519) by a device key certified by the platform; certificates verified offline with the platform public key built into the app; content encrypted with a per-institution key (XSalsa20-Poly1305 secretbox) or sealed to one device (X25519 `crypto_box`); hop limits and expiry; duplicates dropped by id |
| Abuse | Rate limits (only enforced in production so testing is not blocked), chat requests (limits per day, cool-down after a decline), report message, moderator roles |
| Monitoring | Audit log of administrative and sensitive actions (role changes, exports, viewing face data, broadcasts); broadcast failures logged at most once a minute |

### 7.3 Threat model (STRIDE summary)

| Threat | Example | Mitigation |
| --- | --- | --- |
| **S**poofing | Someone signs in as a student | Records-backed passwords; rate limits; one phone and one browser; face capture liveness checks |
| | A forged phone joins the mesh | Device certificates signed by the platform key; envelopes signed by certified keys |
| **T**ampering | Altered SOS on its way through the mesh | Ed25519 signature over the canonical envelope; a changed byte fails verification at every hop and on the server |
| | Forged connector response | HMAC signature with timestamp and nonce |
| **R**epudiation | Admin denies changing a role | Audit log with actor, target, time and IP |
| **I**nformation disclosure | Reading another institution's chats | Fail-closed tenant scope, tested |
| | Seeing other people's roles, phone numbers | Public profile hides roles and contact details unless the viewer has the right permission over that person |
| | Stolen database dump | Message bodies, credentials and face photos encrypted with the app key, which is kept outside the database |
| **D**enial of service | Flooding the API | Rate limiting; queue for heavy work; mesh hop limits and expiry |
| **E**levation of privilege | HOD gives themself super admin | Delegation rule (only roles you could exercise in that area); last super admin protected |

### 7.4 Privacy and law

The design follows the Nigeria Data Protection Act 2023 (NDPA) and GDPR principles:

* **Lawful basis and consent:** policies accepted at first sign-in (versioned); separate, explicit consent for face capture, recorded with time and version; separate choice for sending location with SOS.
* **Children:** under-18s are blocked from chat, calls, status and face capture until guardian consent is recorded, unless the institution confirms it collects consent at admission (a switch, off by default).
* **Minimisation:** the phone keeps only what it needs; status updates expire after 24 hours; SOS locations are blurred after 30 days.
* **Retention:** configurable schedule (`config/sos.php`), applied nightly by `sos:prune`.
* **Rights:** people can download their data and make requests (Account > My data); people can delete their own face photos.
* **Documents:** privacy policy, terms, DPA, DPIA, retention schedule, breach response plan and more are served at `/legal` (sources in `docs/legal/`).

---

## 8. Data design (main tables)

| Table | Purpose | Notes |
| --- | --- | --- |
| institutions | Tenants | settings JSON (feature switches, consent options, limits) |
| users | Members | records link (`external_id`), member type, units, level, minor flag, consent, device sessions |
| org_units | Faculties, departments, admin units, hostels | tree (`parent_id`); areas for permissions |
| roles / role_permissions / role_assignments / user_permissions | RBAC | assignments carry an optional area and expiry |
| conversations / conversation_members | Chats, groups, communities | member flags: role, muted (until), archived, paused |
| messages | Chat messages | body encrypted; `client_id` for idempotent sending from offline phones |
| chat_requests | Ask-before-chat | status, answers seen by the sender |
| call_logs / group_calls / group_call_participants | Calls | signalling goes over WebSocket; media is peer-to-peer |
| status_updates (+ views, reactions, comments, mentions, audience, hidden) | Status | expires after 24 h |
| sos_alerts / sos_responses / safety_checks | Safety | idempotent by `client_id`; offline-raised alerts accepted with their original time |
| devices / mesh_keys / mesh_envelopes | Offline mesh | device public keys, certificates, institution keys, carried envelopes |
| announcements / broadcasts | Notices, pop-ups, marquee | audience JSON (everyone, students, staff, unit, level) |
| face_enrollments / face_captures / face_exports | Face capture | photos encrypted on disk; liveness results; export history |
| pages | Help pages and this document | Markdown, editable by admins |
| audit_logs, consents, data_requests, message_reports | Accountability and compliance | |

**Idempotency:** messages and SOS alerts carry a client-generated UUID (`client_id`). A phone that retries after a timeout, or the same alert arriving twice (once directly, once via the mesh), creates one row.

---

## 9. Realtime design

* **Channels:** `private-user.{id}` (calls, chat requests, status activity, session replaced), `private-conversation.{id}` (messages), `private-institution.{id}` (notices, safety checks, pop-ups and marquee). Channel authorisation reuses membership and tenant checks.
* **Delivery guarantee without WebSockets:** per-user signals are also kept for two minutes in the cache; `/api/pulse` returns them with a cursor, so a client that cannot hold a WebSocket (firewall, proxy) still rings and updates within seconds.
* **Red counts** (unread chats, missed calls, requests) are computed by one query set (`Badges`) and pushed after changes.
* **Calls:** WebRTC; one-to-one and group calls (full mesh, up to 8 people by default). The server only relays signalling (offer, answer, ICE), never media.

---

## 10. Offline mesh networking

* **Transports:** Android uses Google Nearby Connections (Bluetooth + Wi-Fi, P2P_CLUSTER: every phone both advertises and discovers); iPhone uses MultipeerConnectivity; phones on the same Wi-Fi also find each other over the LAN; an optional edge node on a campus access point stores and forwards.
* **Routing:** store-and-forward ("epidemic routing" with limits). Each phone keeps envelopes until they expire and offers them to every new peer, highest priority first (SOS 9, SOS update 8, safety response 7, announcement 6, message 3, receipt 1). A hop counter stops endless circulation.
* **Gateway behaviour:** any phone that gets internet uploads what it carries (`/api/mesh/relay`); the server verifies and ingests each envelope once.
* **Trust without internet:** the platform signs device certificates (user, institution, device, public keys, role, expiry). The platform public key is built into the app, so phones verify each other completely offline. Announcements are only accepted from certificates carrying the "notices" right.
* **Confidentiality:** group traffic is encrypted with the institution's current mesh key (rotated on a schedule); private traffic is sealed to the recipient device's X25519 key.

---

## 11. Feature design notes (selected)

* **Face capture.** Runs Google MediaPipe Face Landmarker in the browser (also inside the phone app's web view). 478 face points per frame give head angles; blendshape scores give blinks and mouth opening. The person is guided through front, blink, left, right, up, down, blink, mouth and front again; each photo is taken only when the pose is right, the face is sharp, evenly lit, centred and alone in view. The server refuses to finish a capture without all seven photos and the live checks. Photos are stored encrypted, shown only to the person and admins with "See captured faces" over them, and can be exported (encrypted ZIP) or written into tables in the school's database for the school's own recognition systems.
* **Pause, mute, archive.** Mute stops alerts (for 8 hours, a week or always). Archive moves a chat out of the main list. Pause records the last message id at the moment of pausing; newer messages are held back from the list, history, red counts and push until the person resumes. Each control has a feature switch.
* **Pop-ups and marquee.** Targeted by the same audience model as notices (everyone, students, staff, a faculty, department, unit or hostel, optionally one level). Pop-ups show every time the app is opened until paused; the marquee slides under the top bar and never blocks chats or calls.
* **Seasonal icons.** The app icon shown in the browser and the chat icon can follow seasons (Christmas, Easter, Eid, Independence Day, New Year) automatically, or an admin can upload their own favicon and chat icon.

---

## 12. Scalability and performance

* **Stateless web servers** behind a load balancer; sessions, cache and queue in Redis or the database (see `docs/scaling.md`).
* **Reverb** scales horizontally with Redis pub/sub.
* **Queues** for push notifications, exports and other slow work.
* **Indexes** on the hot paths (badges, missed calls, status rings, message cursors).
* **Phone data use:** delta sync, compressed images and voice, cursor-based pagination.
* **Web start-up:** a branded opening screen until the chat list is ready; code-splitting for heavy parts (the face model loads only on the capture page).

---

## 13. Testing strategy

| Level | Tool | Examples |
| --- | --- | --- |
| Feature / integration (server) | PHPUnit, SQLite in memory | Tenant isolation, roles and areas, contact policy, chat requests, group calls, live updates, sign-in against records, device sessions, face capture, broadcasts, chat controls |
| Unit (server) | PHPUnit | ID-format matching, official email domains |
| Unit (phone) | Jest | Mesh protocol, envelope encoding and signatures |
| Static | TypeScript strict | Web and phone |
| Interface | Headless Chrome screenshots | Every page at 320, 375, 768 and 1280 px wide, checked for overflow and script errors |
| Manual / acceptance | Institution staff | Each increment before switching it on |

---

## 14. Deployment and operations

* **Small:** one machine, `php artisan sos:serve` (website, live updates and a queue worker together).
* **Large:** web servers behind nginx, Reverb processes, queue workers, scheduler on one machine, MySQL server (see `docs/scaling.md`).
* **Phone app:** Expo dev client builds through EAS; native modules (mesh, WebRTC, camera, web view, video) require a new build when added.
* **Upgrades:** `php artisan migrate` (additive), `npm run build`, restart workers.
* **Backups:** database and `storage/app` (uploads and encrypted face photos). The app key (`APP_KEY`) must be backed up separately: without it encrypted data cannot be read.

---

## 15. Questions people ask (and the answers)

**Why Laravel and not Node/Django/Spring?** Mature, secure defaults (CSRF, hashing, encryption, validation, queues, broadcasting) and first-party realtime (Reverb) and token authentication (Sanctum), so less custom security code. PHP hosting is available on almost every institutional server, including XAMPP.

**Why React Native (Expo) instead of native apps?** One TypeScript codebase for Android and iOS, shared types with the web, and Expo modules for camera, audio, notifications and SQLite. Where native code is essential (Bluetooth/Wi-Fi mesh), it is written as an Expo native module in Kotlin and Swift.

**Why Inertia instead of a separate SPA + API?** Authorisation and routing stay on the server, so web pages cannot drift from the rules. The same JSON API also serves the phone.

**How do you stop one institution seeing another's data?** Every tenant table has `institution_id`; a global scope filters every query and fails closed when no institution is set; the tenant is set before route binding; tests prove it.

**Do you store students' passwords?** No. Passwords are checked against the institution's records at each sign-in; SOS Connect keeps no copy.

**What happens if the internet is down?** The phone app keeps working from its local database; messages and SOS travel phone to phone over Bluetooth and Wi-Fi; the first phone with internet uploads them; duplicates are removed by id.

**Can someone fake an SOS or a notice on the mesh?** No. Every envelope is signed by a device key that the platform has certified; phones check the certificate with the platform public key built into the app. Notices are only accepted from certificates that carry the notices right.

**How is a message protected?** In transit by HTTPS (and on the mesh by encryption with the institution key or sealing to the recipient's device); at rest the body is encrypted with the application key.

**How are calls handled?** WebRTC peer-to-peer media; the server relays only signalling. Group calls use a full mesh, so their size is limited (8 by default).

**How do you prevent misuse of face data?** Explicit consent (recorded), under-18s need guardian consent, photos encrypted, access only with a specific permission and audited, exports encrypted with a password, people can delete theirs, and the feature is off by default.

**How does face capture know the person is real?** Liveness checks: they must blink twice, open their mouth and turn their head both ways on request, while the system checks one face, stillness, sharpness and light. A printed photo cannot do this. For certified anti-spoofing the exported photos can be passed to a dedicated liveness service.

**What SDLC did you follow and why?** Iterative and incremental (Agile) with continuous delivery, because requirements evolved with use, it brings risk forward and every increment is usable. See section 3.

**How do you test?** Automated feature tests for every rule, type checking, phone unit tests and screenshot checks at four screen sizes; regressions get tests. See section 13.

**How does it scale?** Stateless web tier behind a load balancer, Redis for sessions, cache, queue and Reverb scaling, indexes on hot queries, delta sync for phones. See section 12.

**What happens when a student graduates?** The records mark them as graduates; they sign in as alumni and join alumni groups (all alumni, their class year, their department).

**What if the institution's records system is different?** The connector uses query sets per records system, tolerates missing columns and tables, and can run as a separate signed service on the institution's network.

**How do you handle under-18 students?** They can raise SOS and read notices, but chat, calls, status and face capture wait until a guardian's consent is recorded, unless the institution confirms it collects consent at admission.

**Who can see someone's role?** Only that person. Others see names and (if permitted) contact details, and in a group they see who the group admins are.

---

*This document is kept with the system and can be updated by admins (Admin > Design document).*
