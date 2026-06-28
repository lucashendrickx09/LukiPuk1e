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
│   └── deps.py         # Phase 0 — verify ffmpeg / yt-dlp / whisper.cpp
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

## Run this phase

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
| **0** | ✅ Scaffold, config, ledger, dependency checks *(this phase)* |
| 1 | Source management + ingest (yt-dlp, channel polling, permission gate) |
| 2 | Transcription (whisper.cpp, word-level timestamps) |
| 3 | Claude picks the clips (strict-JSON highlight selection) |
| 4 | Cut, reframe (OpenCV 16:9→9:16), animated captions, encode |
| 5 | Posting abstraction (Postiz publisher, scheduling) |
| 6 | One-tap Telegram approval loop |
| 7 | End-to-end run loop + daily reporting |

Each phase stops and shows you what runs before the next begins.
