# Deploying SOS Connect (GitHub Actions → your server)

The workflow `.github/workflows/deploy-production.yml` runs on every push to `main` (and by hand from the Actions tab):

1. **Test and build** on GitHub's machine: installs packages, checks the TypeScript, builds the website and runs all the tests. Pull requests stop here.
2. **Deploy** (only `main`, only if the tests passed): connects to your server over SSH, brings the server's copy to *exactly the commit that was tested*, puts the site in maintenance mode, installs, builds, migrates, refreshes caches, restarts the queue workers and live updates, and brings the site back up (even if a step failed).
3. **Check**: calls `https://your-domain/up` and fails the run if the site doesn't answer.

## Using it from a fork

* Open the fork's **Actions** tab and enable workflows (GitHub switches them off in new forks).
* Add the secrets to the **fork** (Settings → Secrets and variables → Actions). Secrets are never shared from the original repository.
* On the server, the project's `origin` must point at the fork, or the deploy stops and tells you:
  `git remote set-url origin git@github.com:<you>/<fork>.git`
  (give the server read access to the fork with a deploy key: GitHub → fork → Settings → Deploy keys).

## Secrets

| Secret | What to put in it |
| --- | --- |
| `VPS_HOST` | Server address, e.g. `159.198.47.177` |
| `VPS_SSH_USER` | The deploy user, e.g. `prove-deploy` |
| `VPS_SSH_PRIVATE_KEY` | Private key whose public half is in that user's `~/.ssh/authorized_keys` |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan -H <server>` (protects against a fake server) |
| `VPS_PORT` | Optional, if SSH isn't on 22 |
| `VPS_APP_PATH` | Optional, defaults to `/home/prove-deploy/apps/sos-connect-pro` |
| `APP_URL` | Optional, e.g. `https://web.proveownership.com` (for the "site answers" check) |

## The server's `.env` (once)

```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://web.proveownership.com
SESSION_SECURE_COOKIE=true
# SESSION_DOMAIN left empty (cookie for this exact host)
# database or redis; run a worker (below)
QUEUE_CONNECTION=database
BROADCAST_CONNECTION=reverb
# Live updates through the same https address (port 443), proxied to Reverb by nginx
REVERB_PUBLIC_HOST=web.proveownership.com
REVERB_PUBLIC_PORT=443
REVERB_PUBLIC_SCHEME=https
```

The website's own address is always allowed to call its API with the signed-in session, so a wrong or missing `APP_URL` / `SANCTUM_STATEFUL_DOMAINS` no longer causes "401" errors and a page that keeps reloading. Still set `APP_URL` correctly: links in e-mails and QR codes use it.

## Long-running processes (Supervisor or systemd)

```
php /home/prove-deploy/apps/sos-connect-pro/artisan queue:work --sleep=1 --tries=3 --max-time=3600
php /home/prove-deploy/apps/sos-connect-pro/artisan reverb:start --host=127.0.0.1 --port=8080
php /home/prove-deploy/apps/sos-connect-pro/artisan schedule:work
```

Proxy `wss://your-domain/app/` to Reverb in nginx (see `docs/scaling.md`). The deploy restarts the queue and Reverb with `queue:restart` and `reverb:restart`.

## Speed

* Turn on gzip or brotli for `.js` and `.css` in nginx (`gzip on; gzip_types text/css application/javascript;`). The website's first script is about 150 KB compressed; each page loads its own small file when first opened.
* Built files in `public/build/assets` have content hashes, so they can be cached for a year: `location /build/ { expires 1y; add_header Cache-Control "public, immutable"; }`.

## If something goes wrong

* **"files on the server were edited by hand"**: someone changed tracked files on the server. Look with `git status`, then keep them (commit them to the repository) or drop them (`git checkout -- <file>`).
* **"commit … is not in the server's origin"**: the server pulls from a different repository than the one running the workflow (see *Using it from a fork*).
* **Site stays in maintenance**: run `php artisan up` on the server.
