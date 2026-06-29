# Automated YouTube → Short-Form Clipper

Self-hosted pipeline that turns talking-head / podcast YouTube videos (one-off
links **or** whole channels it monitors) into algorithm-optimized vertical
shorts with animated captions, then queues them for **one-tap phone approval**
before posting to Instagram Reels, YouTube Shorts, and TikTok.

Built incrementally, phase by phase. **All 7 phases are complete** — run the
whole chain with `python run.py run` (see below).

---

## Hard rules (enforced in code)

1. **Permission gate.** Sources carry a `permission_status`. Anything
   `unverified` is **blocked** from the pipeline — no download, no clip, no post.
2. **Nothing auto-posts without approval.** Finished clips wait in a review
   queue; you approve from your phone (Telegram); only then does it post.
3. **Idempotency.** A SQLite ledger tracks every source/video/clip/post.
   Nothing is re-downloaded, re-clipped, or re-posted.
4. **Fail loud, don't lose work.** Failed steps log the error and stay
   resumable; clips are never silently dropped.
5. **Free / self-hostable by default** (yt-dlp, ffmpeg, whisper.cpp, local
   models). Paid APIs only where you opt in via `config.yaml`.

---

## Layout

```
clipper/
├── run.py              # single cron-able entrypoint  (python run.py doctor)
├── config.yaml         # all non-secret settings
├── .env.example        # secrets template -> copy to .env
├── requirements.txt
├── app/
│   ├── config.py       # Phase 0 — load config.yaml + .env, resolve paths
│   ├── ledger.py       # Phase 0 — SQLite ledger (sources/videos/clips/posts)
│   ├── deps.py         # Phase 0 — verify ffmpeg / yt-dlp / whisper.cpp
│   ├── ytdlp.py        # Phase 1 — yt-dlp wrapper (enumerate + download)
│   ├── ingest.py       # Phase 1 — source mgmt + ingest (permission gate, dedupe)
│   ├── transcribe.py   # Phase 2 — whisper.cpp / faster-whisper word-level transcripts
│   ├── analyze.py      # Phase 3 — Claude picks clip candidates (strict JSON)
│   ├── render.py       # Phase 4 — ffmpeg cut + OpenCV reframe + karaoke captions
│   ├── publish.py      # Phase 5 — Publisher interface, Postiz, scheduling, gate
│   ├── approve.py      # Phase 6 — Telegram one-tap approval loop
│   ├── pipeline.py     # Phase 7 — end-to-end run loop + daily summary
│   └── webui.py        # Mobile web dashboard / approval server (FastAPI)
├── webui/static/       # the phone dashboard (HTML/CSS/JS + PWA manifest/icons)
├── tests/              # offline self-tests (fakes, no network/binaries needed)
└── data/               # created at runtime (gitignored): inbox/, ready/, ledger.db, ...
```

Modules are named by phase so you can follow the pipeline as it grows.

---

## 📱 Use it from your phone (web dashboard + Tailscale)

The heavy work (download, transcription, ffmpeg) runs on a computer — your phone
is a remote control. `python run.py webui` serves a phone-friendly dashboard that
can run every task and review/approve clips (video preview + Approve / Edit
caption / Reject). Add it to your home screen and it behaves like an app. The
same backend runs unchanged on **Mac now** and **Windows later** — only Tailscale
differs per OS.

### A. Set it up on your Mac (do this first)

1. **Install the tools**
   ```bash
   brew install ffmpeg yt-dlp          # https://brew.sh if you don't have brew
   git clone https://github.com/lucashendrickx09/LukiPuk1e.git
   cd LukiPuk1e/clipper
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure** — in `config.yaml` set `transcription.engine: faster-whisper`
   (no whisper.cpp build), then add a source you have rights to:
   ```bash
   python run.py source add "https://youtube.com/watch?v=…" --permission owner
   ```
   Create `.env` (`cp .env.example .env`) and add `ANTHROPIC_API_KEY` (needed for
   the analyze step). Postiz/Telegram keys are optional and only needed to
   actually post — you can review and approve without them.

3. **Install Tailscale** on the Mac and on your phone — it's a free private
   network so your phone can reach the Mac from anywhere (any Wi-Fi or cellular),
   no public exposure.
   - Mac + iOS/Android apps: <https://tailscale.com/download>
   - Sign in with the **same account** on both, then on the Mac run `tailscale ip -4`
     and note the address (looks like `100.x.y.z`).

4. **Start the dashboard**
   ```bash
   python run.py webui            # serves on 0.0.0.0:8765
   ```

5. **Open it on your phone** → `http://100.x.y.z:8765` (your Mac's Tailscale IP).
   - **iPhone (Safari):** Share → **Add to Home Screen** → you get a full-screen
     app icon.
   - **Android (Chrome):** menu → **Install app / Add to Home screen**.

6. **Use it:** the **Review** tab shows rendered clips with a video preview and
   Approve / Edit caption / Reject. The **Run** tab has buttons for each step
   (or ▶ Run all) and live ledger counts. The **Sources** tab adds/removes
   sources. Tapping Approve schedules the clip (Postiz) — nothing posts without
   your tap.

7. **Keep it running** so your phone can reach it anytime. Quick: leave the
   terminal open, or `nohup python run.py webui &`. As a proper background
   service on macOS, create a `launchd` plist (or run `python run.py run` from
   cron hourly to keep the pipeline moving and `webui` separately for the UI).

### B. Move it to a Windows PC later

Same backend, same commands — only the install differs:

1. Install **Python 3.11** (<https://www.python.org/downloads/>), **ffmpeg** and
   **yt-dlp** (e.g. `winget install Gyan.FFmpeg yt-dlp.yt-dlp`, or
   <https://www.gyan.dev/ffmpeg/builds/>), and **Tailscale for Windows**
   (<https://tailscale.com/download/windows>).
2. ```powershell
   git clone https://github.com/lucashendrickx09/LukiPuk1e.git
   cd LukiPuk1e\clipper
   py -3.11 -m venv .venv; .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   copy .env.example .env        # then edit it
   python run.py webui
   ```
3. Open `http://<windows-tailscale-ip>:8765` on your phone (the home-screen icon
   keeps working — just the IP changes). To keep it always-on, run it with **Task
   Scheduler** (at logon) or as a service via **NSSM** (<https://nssm.cc/>).

> 🔐 **Security:** binding `0.0.0.0` is fine on Tailscale (only your own devices
> can reach it). If you ever use a public tunnel instead, set a `webui.token` in
> `config.yaml` (or `CLIPPER_WEB_TOKEN` in `.env`) — the dashboard will then
> require it. Don't expose port 8765 to the open internet without a token.

> Useful links: Tailscale <https://tailscale.com/download> · ffmpeg
> <https://ffmpeg.org/download.html> · yt-dlp
> <https://github.com/yt-dlp/yt-dlp#installation> · faster-whisper
> <https://github.com/SYSTRAN/faster-whisper> · Anthropic console
> <https://console.anthropic.com> · Postiz <https://postiz.com>.

---

## Install

### 1. Python deps

```bash
cd clipper
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

> Phase 0's `doctor` only needs `PyYAML` (and optionally `python-dotenv`), so it
> runs even before the full install.

### 2. External binaries

The pipeline shells out to these. `doctor` checks for them and prints a
checklist for anything missing.

**Ubuntu / Debian**

```bash
# ffmpeg + ffprobe
sudo apt-get update && sudo apt-get install -y ffmpeg

# yt-dlp (newest via pip; the apt package is often stale)
python3 -m pip install -U yt-dlp

# whisper.cpp (build + grab the base.en model)
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build -j
sh ./models/download-ggml-model.sh base.en
# the binary is build/bin/whisper-cli — point config at it (see below)
```

**macOS (Homebrew)**

```bash
brew install ffmpeg yt-dlp

git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build -j
sh ./models/download-ggml-model.sh base.en
```

Then tell `config.yaml` where whisper.cpp lives:

```yaml
transcription:
  whisper_cpp_bin: "/path/to/whisper.cpp/build/bin/whisper-cli"
  whisper_cpp_model_path: "/path/to/whisper.cpp/models/ggml-base.en.bin"
```

> Prefer not to build whisper.cpp? Set `transcription.engine: faster-whisper`
> in `config.yaml` and `pip install faster-whisper` — no binary needed.

### 3. Secrets

```bash
cp .env.example .env
# fill in keys as you reach each phase:
#   ANTHROPIC_API_KEY  (Phase 3)   POSTIZ_API_KEY (Phase 5)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (Phase 6)
```

Secrets are **only** ever read from `.env` / the environment — never from
`config.yaml`, never hardcoded.

---

## Run — Phase 7 (the whole chain) ⭐

```bash
python run.py run                       # ingest -> transcribe -> analyze -> render -> approve -> publish
python run.py run --skip ingest,publish # run a subset
python run.py run --no-summary          # skip the daily Telegram summary
```

**What you should see:** a one-line status per step. Every step is idempotent and
operates on whatever the ledger holds, so `run` is **safe to invoke repeatedly**
(cron-friendly) — nothing is re-downloaded, re-clipped, or re-posted. A step that
fails (e.g. a missing API key for one stage) is reported and the chain
**continues** — later stages still process whatever earlier runs produced. Once
per day it sends a Telegram summary (videos scanned, clips made, posted,
rejected, errors).

The flow stops at **approval** by design: `run` renders clips to `/ready` and
sends them to Telegram, but they only post after you tap ✅ (Rule 2). Run it on a
schedule and clear the queue from your phone whenever you like.

### Cron

```cron
# hourly, from the clipper/ directory, with .env loaded
0 * * * * cd /path/to/clipper && /path/to/clipper/.venv/bin/python run.py run >> data/run.log 2>&1
```

### GitHub Actions (example)

`.github/workflows/clipper.yml` — illustrative; see the caveat below.

```yaml
name: clipper
on:
  schedule: [{ cron: "0 * * * *" }]   # hourly
  workflow_dispatch: {}
jobs:
  run:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: clipper } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: pip install -r requirements.txt
      # ledger + downloads must persist between runs for idempotency:
      - uses: actions/cache@v4
        with: { path: clipper/data, key: clipper-data }
      - run: python run.py run
        env:
          ANTHROPIC_API_KEY:  ${{ secrets.ANTHROPIC_API_KEY }}
          POSTIZ_API_KEY:     ${{ secrets.POSTIZ_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
```

> ⚠️ GitHub Actions runners are ephemeral. The SQLite **ledger and downloads in
> `data/` must persist** between runs or idempotency breaks — the cache step above
> is a best-effort approximation. For production, prefer a small always-on box
> with cron (or persist `data/` to real storage). Use `faster-whisper`
> (`transcription.engine`) in CI to avoid building whisper.cpp.

Offline self-test (full chain with fakes — idempotency, isolation, summary):

```bash
python -m unittest tests.test_phase7 -v
```

## Run — Phase 6 (Telegram approval)

```bash
python run.py approve              # one pass: notify new /ready clips + handle taps
python run.py approve --poll       # stay running, long-poll for taps (Ctrl-C to stop)
```

**What you should see:** each `ready` clip is sent to your Telegram once (preview
video + title/caption/hashtags + hook_score + **source permission status**) with
inline buttons **✅ Approve & schedule | ✏️ Edit caption | ❌ Reject**:
- **Approve** → clip `approved` and handed to the Phase 5 publisher (spaced
  schedule). **Reject** → archived (`rejected`) with a logged reason. **Edit** →
  reply with new caption text; it's applied, then approved + scheduled.

This is the gate that makes **Rule 2** real — clips never leave `ready` without a
tap. Notifications are idempotent (each clip sent once), and the update offset is
persisted so taps aren't re-processed. Run it from cron for one pass, or `--poll`
on a small box to clear the day's queue in under a minute from your phone.

Needs a Telegram bot: create one via @BotFather → `TELEGRAM_BOT_TOKEN`, and your
`TELEGRAM_CHAT_ID`, both in `.env`. Set `telegram.enabled: false` to disable.

Offline self-test (message/keyboard/callbacks + approve/reject/edit flows):

```bash
python -m unittest tests.test_phase6 -v
```

## Run — Phase 5 (publish)

```bash
python run.py publish              # schedule APPROVED clips to platforms
python run.py publish --clip 12    # one approved clip
```

**What you should see:** `publish` schedules every clip with status `approved`
(set by the Phase 6 Telegram loop) to each configured platform via the
`Publisher` (default `PostizPublisher`), with day-spaced slots from
`posting.per_platform` so clips never post all at once. Per-platform metadata is
truncated to each platform's title/caption/hashtag limits. A `posts` row
(scheduled/posted/failed) is written per clip+platform; once all platforms are
scheduled the clip moves `approved → posted`. Re-running never double-posts
(unique clip+platform), and a per-platform failure is recorded as `failed` and
retried next run.

**Two guarantees enforced in code:**
- **Nothing auto-posts** (Rule 2) — only `approved` clips are touched; a `ready`
  (un-approved) clip is never scheduled.
- **Permission gate** (Rule 1) — a clip whose source isn't
  owner/licensed/fair_use is **BLOCKED**; no post is ever created for it.

Needs a self-hosted Postiz (`publisher.postiz.base_url` + channel ids) and
`POSTIZ_API_KEY` in `.env`. No-ops on an empty/unapproved queue without a key.

Offline self-test (metadata, scheduling, gate, idempotency — no Postiz):

```bash
python -m unittest tests.test_phase5 -v
```

## Run — Phase 4 (cut, reframe, caption)

```bash
python run.py render                  # render all candidate clips -> data/ready/
python run.py render --clip 12        # one clip by id
python run.py render --force          # re-render clips already marked ready
```

**What you should see:** each `candidate` clip is cut from its source, reframed
16:9 → 9:16 (OpenCV face-tracking with a smoothed crop path; **center-crop
fallback** if no face / no OpenCV), captioned with karaoke word-by-word
highlighting burned from the whisper word timings, loudness-normalized, and
written as a 1080×1920 H.264 file to `data/ready/clip_<id>.mp4`. The clip moves
`candidate → cutting → ready`; re-running skips finished clips unless `--force`.
A render failure is recorded as `status=error` (with the message) and the run
continues. Needs `ffmpeg`; face-tracking additionally needs `opencv-python`
(`pip install opencv-python`). Caption style and output settings are configurable
under `caption:` / `video:` in `config.yaml`.

Offline self-test (colour/caption/ASS/smoothing + orchestration, no ffmpeg):

```bash
python -m unittest tests.test_phase4 -v
```

## Run — Phase 3 (Claude picks the clips)

```bash
python run.py analyze                       # analyze all transcribed videos
python run.py analyze --video VIDEO_ID --dry-run   # one video, print picks, don't save
python run.py analyze --force               # re-analyze (drops prior candidates)
```

**What you should see:** Claude reads each transcript and returns candidate clips
(`start/end/title/caption/hashtags/hook_score/reason`). Clips scoring **≥
`hook_score_threshold`** (default 7) are stored as `candidate`; the rest are
stored as `rejected` with the reason. Cut points are snapped to whole-word
boundaries and clamped to the configured length, the video moves
`transcribed → analyzed`, and re-running does nothing unless `--force`. Output is
parsed defensively (code fences stripped, JSON validated) with one automatic
retry; persistent bad output is recorded as `status=error` and the run continues.

This is the first **paid** step: set `paid_apis.use_anthropic_api: true` in
`config.yaml` and `ANTHROPIC_API_KEY` in `.env`. The model is configurable
(`claude.model`, default `claude-opus-4-8`). On an empty queue it no-ops without
needing a key.

Offline self-test (defensive parsing, gating, snapping, idempotency — no API):

```bash
python -m unittest tests.test_phase3 -v
```

## Run — Phase 2 (transcribe)

```bash
python run.py transcribe              # transcribe all downloaded videos
python run.py transcribe --video VIDEO_ID --force   # one video, re-do it
```

**What you should see:** each downloaded video gets a word-level transcript cached
to `data/transcripts/<id>.json` (containing `segments` *and* `words` with
start/end times), the video's ledger status moves `downloaded → transcribed`, and
a row lands in the `transcripts` table. Re-running transcribes **nothing new**
unless `--force`. A failure is recorded as `status=error` and the run continues.

Engine is set by `transcription.engine` in `config.yaml`:
- `whisper.cpp` (default) — needs the built binary + a `ggml-*.bin` model and
  `ffmpeg` (used to extract 16 kHz mono audio). Point `whisper_cpp_bin` /
  `whisper_cpp_model_path` at your build.
- `faster-whisper` — simplest path: `pip install faster-whisper`, no binary,
  decodes the video directly and returns word timestamps natively.

Offline self-test (parser + orchestration, no whisper/ffmpeg needed):

```bash
python -m unittest tests.test_phase2 -v
```

## Run — Phase 1 (source management + ingest)

```bash
# add a source — permission is REQUIRED (owner | licensed | fair_use | unverified)
python run.py source add "https://www.youtube.com/@SomePodcast" --permission licensed
python run.py source add "https://youtu.be/VIDEO_ID" --permission owner   # --type auto-detected

python run.py source list                 # see all sources + permission status
python run.py ingest --dry-run            # enumerate + ledger new videos, no download
python run.py ingest                      # download new, un-ledgered videos -> data/inbox/
python run.py source rm 1                 # remove by id or URL
```

**What you should see:** `source add` echoes the new id; an `unverified` source is
flagged **BLOCKED** and is skipped by `ingest`. `ingest` enumerates each cleared
source, records new videos in the ledger, downloads them to `data/inbox/`, and
advances `last_seen_video_id` for channels. Re-running downloads **nothing new**
(idempotent). A single failed download is logged and recorded as `status=error`
without aborting the rest. Sources listed in `config.yaml` are synced into the
ledger automatically on ingest. Requires `yt-dlp` (+`ffmpeg` for merged formats);
without them, ingest fails loud with the install command instead of dropping work.

Offline self-test (no network / no yt-dlp needed):

```bash
python -m unittest tests.test_phase1 -v
```

## Run — Phase 0 (startup check)

```bash
cd clipper
python run.py doctor
```

### What you should see if it worked

A five-section startup report:

1. **Config & paths** — `config.yaml` loaded; `data/` subdirs created.
2. **Ledger** — `data/ledger.db` created at schema v1 with row counts.
3. **External binaries** — ✔ for each found tool; ✘ + exact install command
   for anything missing.
4. **Secrets** — which `.env` keys are set vs. missing (missing is only fatal
   for the phase that needs them).
5. **Sources & permission gate** — every configured source with its permission
   status; `unverified` ones are flagged **BLOCKED**.

On a fresh machine you'll see the ledger created and a checklist telling you to
install ffmpeg / yt-dlp / whisper.cpp. Install those, re-run, and the binary
section turns all-green. `doctor` is idempotent and safe to run repeatedly.

Use `python run.py doctor --strict` in CI to exit non-zero when a required
binary is missing.

---

## Roadmap

| Phase | What it adds |
|------:|--------------|
| **0** | ✅ Scaffold, config, ledger, dependency checks |
| **1** | ✅ Source management + ingest (yt-dlp, channel polling, permission gate) |
| **2** | ✅ Transcription (whisper.cpp / faster-whisper, word-level timestamps) |
| **3** | ✅ Claude picks the clips (strict-JSON highlight selection) |
| **4** | ✅ Cut, reframe (OpenCV 16:9→9:16), animated captions, encode |
| **5** | ✅ Posting abstraction (Postiz publisher, scheduling, permission gate) |
| **6** | ✅ One-tap Telegram approval loop |
| **7** | ✅ End-to-end run loop + daily reporting *(this phase)* |

All phases complete. `python run.py run` chains them end-to-end; `python run.py
doctor` checks your setup.
