# Security

How SOS Connect protects accounts and personal data, and what to set on the server.

## Server checklist

Run `php artisan sos:doctor` after every deploy. Its **Security** section checks the following:

| Setting | Value |
|---|---|
| `APP_ENV` | `production` |
| `APP_DEBUG` | `false` (otherwise error pages show code and settings) |
| `APP_KEY` | Set once and **never changed**. It encrypts sessions and personal data, so changing it makes that data unreadable. Back it up somewhere safe, separately from database backups. |
| `APP_URL` | `https://…` |
| `SESSION_SECURE_COOKIE` | `true` |
| `SESSION_ENCRYPT` | `true` |
| `SECURITY_CSP` | `enforce` |

Other things to check:
- The web server's document root must be `public/` only.
- Source maps (`*.map`) must not be published. Builds don't create them.

## What the browser can see

- **No secrets reach the browser.** Database passwords, connector secrets, Paystack secret keys and the TURN secret stay on the server. With `TURN_SECRET` set, calls get TURN passwords that expire after a few hours. A fixed `TURN_USERNAME`/`TURN_PASSWORD` does reach the browser, because calls need it, so use `TURN_SECRET` (coturn `use-auth-secret`).
- **No original source code.** Production builds send only minified files, without source maps.
- **Numbers in addresses and data (like `/chats/42`) are references, not keys.** Every request checks who is asking. A number from another school, another person's chat or another person's file is refused (see `tests/Feature/SecurityTest.php`). Uploaded files have random, unguessable names and are served only to members of the same school.
- **Signed-in pages are never cached**, so Back after signing out shows nothing.

## Encryption

- **In transit:** HTTPS only. HSTS tells browsers never to use plain http for a year. Cookies are `Secure`, `HttpOnly` and `SameSite=Lax`.
- **At rest, AES-256 with the app key:**
  - chat message text;
  - phone and WhatsApp numbers (a keyed fingerprint lets a number still be matched);
  - SOS alert notes, location labels and resolution notes;
  - chat request notes;
  - privacy request details;
  - platform chat messages;
  - connector secrets and database settings;
  - mesh keys;
  - sessions.

  A copied database or backup shows none of these without `APP_KEY`.
- **Passwords** are hashed with bcrypt, never stored.
- Emails, names and matric/staff numbers stay readable, because sign-in and search look them up directly.

## Attacks covered

| Attack | Protection |
|---|---|
| Password guessing | Three limits per sign-in: 5 failures for one account from one address (15-minute wait), `SECURITY_LOGIN_PER_ACCOUNT` per hour for one account from all addresses, and `SECURITY_LOGIN_PER_IP` per hour from one address across accounts. Failed attempts are slowed and logged. Other actions are rate-limited too (messages, uploads, SOS, chat requests, searches). |
| SQL injection | All queries use bound parameters. Search wildcards are escaped and the length is capped. |
| Cross-site scripting | React escapes all text. Markdown pages are rendered with raw HTML escaped and unsafe links removed. The Content-Security-Policy runs only this site's own scripts, plus one start-up script allowed by a per-request nonce, so injected scripts don't run. |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| CSRF | Laravel CSRF tokens on every form. The only exceptions are the signed Paystack webhook and browser CSP reports. |
| Malicious uploads | The file type is read from the file's contents against an allowlist; the name the browser sends is ignored. Files are stored under random names outside the web root and served with `nosniff` and a sandboxing CSP, so a file can't run as a page. |
| SSRF | The server refuses to call private or internal addresses (localhost, 10.x, 192.168.x, cloud metadata) and doesn't follow redirects. Set `SOS_CONNECTOR_ALLOW_PRIVATE=true` only when the school's connector is on the same private network. |
| Session theft | One browser and one phone per account at a time. Sessions are encrypted and their IDs change at sign-in. |
| Data across schools | Every record is tied to its institution, and queries are filtered to the signed-in person's institution automatically. |

## When something is blocked

The browser reports blocked content to `/csp-report`, and these reports are logged as `CSP blocked`. If a legitimate feature stops working after a change, set `SECURITY_CSP=report` to log without blocking, fix the cause, then set it back to `enforce`.

## Dependencies

Run these regularly:
- `npm audit --omit=dev` (website): currently clean.
- `composer audit`.
- `cd mobile && npm audit --omit=dev`: the current warnings are in Expo's build tools, not code that runs on phones. They're fixed by upgrading Expo.
