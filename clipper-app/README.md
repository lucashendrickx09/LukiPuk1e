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

## Standalone install (later, optional)

Expo Go needs the dev server running. For a real installed app that works
without it, build once with EAS:
```bash
npx eas build --profile preview --platform ios    # or android
```
(Requires a free Expo account; iOS install via TestFlight needs an Apple
Developer account.) The `app.json` already includes the cleartext/local-network
permissions the LAN connection needs in standalone builds.
