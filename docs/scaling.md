# Running SOS Connect for a large campus (load balancing)

One machine running `php artisan sos:serve` is enough for a pilot or a small institution. When thousands of people are signed in at once, spread the work like this.

## 1. What has to be shared between servers

Several web servers can sit behind one load balancer only if they share the same state. Set these in every server's `.env`:

```
SESSION_DRIVER=redis        # or database — never file
CACHE_STORE=redis           # or database — live signals and rate limits live here
QUEUE_CONNECTION=redis      # or database
REDIS_HOST=10.0.0.20        # your shared Redis machine
FILESYSTEM_DISK=s3          # or a shared network folder for uploads (voice notes, photos, files)
```

With `CACHE_STORE=file` each server only sees its own cache, so a phone polling server B would miss a call signal written on server A. Redis (or `database` if you have no Redis) fixes that.

## 2. Web servers

Run the same code on each machine (`php artisan optimize` after every deploy) with PHP-FPM, and put nginx (or any load balancer) in front:

```nginx
upstream sos_web {
    least_conn;
    server 10.0.0.11:80;
    server 10.0.0.12:80;
    server 10.0.0.13:80;
}

upstream sos_live {
    server 10.0.0.30:8080;   # Reverb
}

server {
    listen 443 ssl http2;
    server_name chat.example.edu;
    client_max_body_size 30m;

    location /app/ {                       # live updates (WebSocket)
        proxy_pass http://sos_live;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600;
    }

    location / {
        proxy_pass http://sos_web;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The app already trusts `X-Forwarded-For` / `X-Forwarded-Proto` from the load balancer, so sign-in links, rate limits and audit IPs stay correct. No sticky sessions are needed once sessions are shared.

## 3. Live updates (Reverb)

One Reverb process handles many thousands of open connections. For more, run several and let them share messages through Redis:

```
REVERB_SCALING_ENABLED=true
REVERB_HOST=chat.example.edu
REVERB_PORT=443
REVERB_SCHEME=https
```

Start each with `php artisan reverb:start --host=0.0.0.0 --port=8080` (under Supervisor or a Windows service) and list them all in the `sos_live` upstream. If live updates are ever unreachable, web and phones fall back to the pulse check automatically, so nothing is lost — it is just slower.

## 4. Background work

Push notifications, broadcasts and records sync go through the queue. Run workers on one or more machines:

```
php artisan queue:work --sleep=1 --tries=3 --max-time=3600
php artisan schedule:work        # on ONE machine only
```

## 5. Database

- Keep MySQL on its own machine with enough memory for the indexes (`innodb_buffer_pool_size` ≈ 60–70% of RAM).
- Run `php artisan migrate` once per deploy — it adds the indexes the badge, missed-call and status queries need.
- A read replica can be added later through `DB_READ_HOST` in `config/database.php` if reports become heavy.

## 6. Quick checklist

| Item | Small (1 machine) | Large (many machines) |
| --- | --- | --- |
| Start | `php artisan sos:serve` | nginx + PHP-FPM, Reverb, queue workers |
| Sessions / cache | database / file | Redis |
| Uploads | local disk | S3 or shared folder |
| Live updates | built-in Reverb | Reverb ×N with `REVERB_SCALING_ENABLED` |
| Scheduler | built-in | `schedule:work` on one machine |
