# Automated YouTube → Short-Form Clipper

Self-hosted pipeline that turns talking-head / podcast YouTube videos (one-off
links **or** whole channels it monitors) into algorithm-optimized vertical
shorts with animated captions, then queues them for **one-tap phone approval**
before posting to Instagram Reels, YouTube Shorts, and TikTok.

Built incrementally, phase by phase. **This is Phase 0 — scaffold & config.**

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
│   └── render.py       # Phase 4 — ffmpeg cut + OpenCV reframe + karaoke captions
├── tests/              # offline self-tests (fakes, no network/binaries needed)
└── data/               # created at runtime (gitignored): inbox/, ready/, ledger.db, ...
```

Modules are named by phase so you can follow the pipeline as it grows.

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
| **4** | ✅ Cut, reframe (OpenCV 16:9→9:16), animated captions, encode *(this phase)* |
| 5 | Posting abstraction (Postiz publisher, scheduling) |
| 6 | One-tap Telegram approval loop |
| 7 | End-to-end run loop + daily reporting |

Each phase stops and shows you what runs before the next begins.
