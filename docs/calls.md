# Making voice and video calls work everywhere

Calls go straight from one device to the other (WebRTC). That works on the same Wi-Fi, but phones on mobile data
or on two different networks usually can't reach each other directly. A **relay (TURN) server** passes the call
along in those cases. Without one, calls ring but stay on "Connecting…" and then drop.

`php artisan sos:doctor` tells you whether a relay is set up and reachable.

## Option A: your own relay on the server (free, about 10 minutes)

On the VPS (Ubuntu/Debian):

```bash
sudo apt install coturn
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
openssl rand -hex 32          # copy the output: this is the shared secret
```

Write `/etc/turnserver.conf` (replace the two values):

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=PASTE_THE_SECRET_HERE
realm=web.proveownership.com
total-quota=300
no-multicast-peers
no-cli
min-port=49152
max-port=65535
# The server's public IP (needed when the VPS sits behind NAT; harmless otherwise)
external-ip=PUBLIC_IP_OF_THE_SERVER
```

Open the firewall and start it:

```bash
sudo ufw allow 3478/tcp && sudo ufw allow 3478/udp && sudo ufw allow 49152:65535/udp
sudo systemctl enable --now coturn
```

Then in the app's `.env`:

```
TURN_HOST=web.proveownership.com
TURN_SECRET=PASTE_THE_SAME_SECRET_HERE
```

and run `php artisan config:cache`. (If your hosting provider also has a firewall in its control panel, open the same ports there.)

Optional, for networks that only allow port 443-style traffic: give coturn your certificate
(`tls-listening-port=5349`, `cert=…`, `pkey=…`), open 5349/tcp and set `TURN_TLS=true`.

## Option B: a hosted relay service

Services such as Metered, Twilio or Cloudflare Calls give you a list of TURN addresses with a username and password:

```
TURN_URLS=turn:relay.example.com:3478,turn:relay.example.com:443?transport=tcp
TURN_USERNAME=…
TURN_PASSWORD=…
```

Then `php artisan config:cache`.

## Also needed

* The site must be on **https** (browsers only give the camera and microphone to secure sites).
* Live updates: with Reverb working, calls ring instantly. Without it, the app still rings within a few seconds
  and checks every second during a call, so calls still connect.
* Phone app: calls need the installed app build (not Expo Go), with microphone and camera permission allowed.
