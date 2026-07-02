# Clipper — native phone app (Expo)

A native iOS/Android app (same stack as the other Expo apps in this repo) that
remote-controls the clipper pipeline running on your computer:

- **Review** — rendered clips with a real video player + ✅ Approve / ✏️ Edit
  caption + approve / ❌ Reject. Nothing posts without your tap.
- **Run** — run every pipeline step (or ▶ Run all) with live job status and
  ledger counts.
- **Sources** — add/remove sources with the required permission dropdown.
- **Server** — point the app at your computer, with a built-in connection test.

The heavy work (download, whisper, ffmpeg) always runs on the computer — this
app talks to the same FastAPI backend as the web dashboard
(`python run.py webui` in `../clipper`).

## Run it on your phone (Expo Go — no app store needed)

1. On the computer: start the backend **and** keep it running:
   ```bash
   cd ../clipper && source .venv/bin/activate && python run.py webui
   ```
2. Install **Expo Go** on your phone (App Store / Play Store).
3. In this folder:
   ```bash
   npm install
   npx expo start
   ```
   A QR code appears — scan it with the phone camera (iOS) or Expo Go (Android).
   Phone and computer must be on the same Wi-Fi.
4. In the app, open the **Server** tab and enter your computer's address, e.g.
   `http://Lucass-MacBook-Air.local:8765` (find the name with
   `scutil --get LocalHostName`), then **Save & test**.

When you later get Tailscale, enter the `100.x.y.z` address instead — the app
then works from anywhere, not just home Wi-Fi.

## Standalone install (a real app icon, no dev server)

Expo Go needs `npx expo start` running. For a permanently installed app,
`eas.json` is already configured — one-time setup, then one command per build:

```bash
npx eas init          # once: log in / create a free account at expo.dev,
                      # links the project (writes projectId into app.json)
```

**Android — easiest (free):**
```bash
npx eas build --profile preview --platform android
```
Builds an APK in Expo's cloud; when done you get a link/QR — open it on the
phone and install directly. Done.

**iPhone — pick one:**
- **Free, using your Mac + Xcode:** plug the phone in and run
  `npx expo run:ios --device` (needs Xcode from the App Store and a free Apple
  ID). Installs a real app; Apple expires free-signed apps after ~7 days, so
  re-run to refresh.
- **Proper distribution:** an Apple Developer account ($99/yr), then
  `npx eas build --profile production --platform ios` and
  `npx eas submit -p ios` to get it in TestFlight — installs like a normal app
  and doesn't expire.

The `app.json` already includes the cleartext/local-network permissions the LAN
connection needs in standalone builds.
