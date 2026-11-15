# SOS Connect

Institution-based chat, calls and SOS alerts that keep working **with or without internet**.
Online it uses the server; offline it uses Wi-Fi access points, Bluetooth and Wi-Fi Direct between phones,
and the first phone that finds internet delivers everything it carried.

One repository:

| Folder | What it is |
| --- | --- |
| `/` (Laravel 12 + Inertia + React) | API, realtime (Reverb), web app, admin, institution onboarding, legal pages |
| `mobile/` | React Native (Expo dev client) app with the offline mesh (`modules/mesh-nearby` native module) |
| `connector/` | Reads an institution's records (`src/Directory.php`, SQL in `queries/`). Used inside the app (direct mode) or deployed as a separate service on the institution's network |
| `edge-node/` | Optional relay for a campus Wi-Fi access point (laptop / Raspberry Pi) |
| `docs/legal/` | Privacy policy, terms, DPA, DPIA, retention, breach plan… (served at `/legal`) |

## Server setup

```bash
composer install --no-dev --optimize-autoloader
cp .env.example .env && php artisan key:generate
php artisan sos:platform-keys          # paste both lines into .env; the PUBLIC key also goes into mobile/.env and edge-node/.env
php artisan migrate --force
php artisan db:seed --force            # creates the platform admin (set SEED_PLATFORM_ADMIN_EMAIL/PASSWORD first)
npm ci && npm run build
php artisan reverb:start               # websockets (run under Supervisor)
php artisan queue:work --queue=urgent,default   # push notifications (Supervisor)
# cron: * * * * * php /path/artisan schedule:run   (SOS escalation every minute, retention nightly)
```

Production: PHP 8.3 with `sodium`, MySQL 8 (own database — never the institution's), Redis, HTTPS, coturn for calls
(`use-auth-secret`, same secret as `TURN_SECRET`). Scale by running several app servers behind a load balancer; Reverb
scales horizontally with Redis (`REVERB_SCALING_ENABLED=true`).

## Institution onboarding

1. Institution registers at `/register-institution` and accepts the DPA.
2. Its admin connects their records in **Admin → Settings → Your records**: either the database details (read-only
   user; the app reads it directly) or the address of a separate connector on their network.
3. They add their email domains and matric/staff number formats under **Sign-in**, so the single sign-in form
   recognises their members (there is no public list of institutions).
4. **Test connection** must pass; a platform admin verifies the institution and activates it.
5. Nothing is imported in bulk. Each person is read from the records when they sign in; faculties, departments,
   units, hostels and courses come in when the admin presses **Sync from records** (Admin → Structure) and nightly
   if automatic sync is on (`php artisan schedule:work` locally, cron in production). See `docs/connecting-records.md`.
6. Moving from the previous campus chat? `php artisan sos:import-campus-chat <code>` brings people, chats, groups,
   messages and notices across. See `docs/importing-old-chat.md`.
4. Students and staff sign in with their usual portal email / matric number and password.

## Mobile

```bash
cd mobile && npm install
cp .env.example .env   # API URL, Reverb key, platform PUBLIC key
npx expo prebuild && npx expo run:android      # native module needs a dev/EAS build, not Expo Go
eas build -p android --profile production       # Play Store bundle
```

## Tests

`php artisan test` — tenant isolation, connector login (signed responses, inactive members, minors), mesh ingest
(signatures, tampering, gateway from another institution, de-duplication with the sender's own outbox), SOS flow.
