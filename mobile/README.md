# SOS Connect phone app

Expo (React Native) app for students, staff and parents. It covers chats, communities, SOS, updates
and offline messaging. **Admin work isn't in the app.** Roles, permissions, structure, feature switches,
parents, reports and institution settings are all managed on the website.

## What's in the app

| Tab | What it does |
|---|---|
| **Chats** | All chats and groups, with search and filters (unread, groups, private). Start a private chat or a new group. |
| **Communities** | University → faculty → department communities with their groups: notices, general, students or staff, levels, courses, hostel. |
| **SOS** | Hold to send. It goes to the server, nearby phones (Bluetooth/Wi-Fi) and an SMS fallback all at once. Shows alerts; responders can acknowledge them. |
| **Updates** | Status updates (24 hours), "Are you safe?" checks and notices. |
| **Me** | Profile from the records (faculty, programme, level, hostel), children (parents), SOS location setting, offline relaying, privacy, sign out. |

In a chat you can send text (it works offline too), photos, documents and voice notes. Photos, files and voice
notes made offline wait on the phone and send themselves when the internet comes back. Long-press a message to
reply, copy, edit (your own, within 15 minutes), delete or report it. Type @ in a group to mention someone: they
get a notification even if they muted the group. The search button in a chat finds messages on the phone at once
and in the full history when online. Tap a quoted message to jump to it. Scroll up to load older messages. You can
also make voice and video calls. Tapping the title opens group info: members, mute
and leave. Group admins also get **that group's own controls**: rename, who can post, add or remove
people, and make admins. They only get the powers they were given for that group, just like in any
chat app.

Every feature the institution switches off under Modules on the website disappears from the app.
These include communities, status, notices, safety checks, photos and files, calls, private chats,
member-made groups and offline messaging. SOS can never be switched off.

## Run it on your phone (development)

The app uses native code (Bluetooth mesh, WebRTC calls, audio), so **Expo Go won't work**. You need a
development build, made once; after that, code changes reload instantly.

1. **Install:** `cd mobile && npm install`, then `npx expo install --fix`.
2. **Start Laravel so phones can reach it:** run `php artisan serve --host 0.0.0.0 --port 8000` and allow
   PHP through Windows Firewall. Find your PC's Wi-Fi address with `ipconfig` (e.g. `192.168.1.20`).
3. **Create `mobile/.env`:**
   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.20:8000
   EXPO_PUBLIC_PLATFORM_PUBLIC_KEY=<SOS_PLATFORM_SIGN_PUBLIC from the Laravel .env>
   # Only if you run Reverb (php artisan reverb:start):
   EXPO_PUBLIC_REVERB_KEY=<REVERB_APP_KEY>
   EXPO_PUBLIC_REVERB_HOST=192.168.1.20
   EXPO_PUBLIC_REVERB_PORT=8080
   EXPO_PUBLIC_REVERB_SCHEME=http
   ```
   Without Reverb the app still works: it syncs when it opens, when the network returns, and every 2 minutes.
4. **Build and install the development app.** Use one of these:
   - **Android, on your PC:** install Android Studio (SDK and an emulator, or USB debugging on a phone),
     then run `npx expo run:android`.
   - **Android or iPhone, in the cloud:** `npm i -g eas-cli`, `eas login`, `eas init`, then
     `eas build -p android --profile development`. Install the APK it gives you. For iPhone you need a paid
     Apple developer account: `eas build -p ios --profile development`.
5. **Run it:** `npx expo start --dev-client`, then open the app on the phone. Sign in with a matric number,
   staff email or number, and that person's records password.

Plain-HTTP addresses only work in development. Production must use HTTPS.

## Push notifications

- **Android:** create a Firebase project, add an Android app with package `ng.sosconnect.app`, and download
  `google-services.json` into `mobile/`. In the Expo dashboard (Credentials → Android → FCM V1), upload a
  Firebase service-account key. Then rebuild.
- **iPhone:** `eas credentials` creates the push key with your Apple developer account.

Without these, everything works except notifications while the app is closed.

## Testing offline messaging and SOS (needs two or more phones)

1. Sign in on both phones while online, so each gets its offline keys. Open each phone's **Me → Offline and
   nearby** and allow Bluetooth, location and nearby devices.
2. Turn off mobile data and Wi-Fi on both phones (keep Bluetooth on), or put both on a Wi-Fi network with no
   internet.
3. Send a message in a shared group. It should arrive on the other phone with an antenna mark, meaning it came
   through phones nearby.
4. Hold SOS on one phone. The other should show the alert. Turn the internet back on for either phone: the
   alert reaches the server and the web SOS page.

On Android, **Keep relaying alerts when the app is closed** (in Offline and nearby) keeps passing alerts on in
the background. iPhones relay while the app is open.

## Release builds

`eas build -p android --profile production` makes a Play Store bundle; `--profile preview` makes an APK to
share directly. Set the production `EXPO_PUBLIC_*` values (HTTPS) in EAS environment variables first.

## Checks

- `npm test` runs the automated tests in `__tests__/`: offline encryption and signatures, @mentions, communities,
  status, formatting and file links.
- `npm run typecheck` checks the code.
- `npx expo export --platform android` checks that the app bundles.
