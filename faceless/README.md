# Faceless Shorts pipeline

Local, no-paid-API pipeline that turns a pre-written script into a finished
1080×1920 YouTube Short and (optionally) uploads it. Built for Python 3.11 on
Linux/Windows with an RTX 4070 (12 GB VRAM).

> This project lives in its own `faceless/` directory so it doesn't collide
> with the Expo app at the repo root. Run every command from inside `faceless/`.

```
config.yaml     niche, voice, fps, resolution, mix levels, upload options
scripts.json    your queue of pre-written scripts (you supply these)
run.py          orchestrator: one video end-to-end, resumable per stage
state.db        sqlite: scripts used, videos, per-stage status, uploads
pipeline/
  script.py     pop next unused script, mark used, write script.json
  tts.py        Kokoro-82M  -> voice.wav (24 kHz mono)
  align.py      faster-whisper large-v3 -> word-level timings (align.json)
  visuals.py    per scene: card (Playwright) | stock (Pexels) | generated (Flux)
  assemble.py   ffmpeg: timed scenes, Ken Burns, ASS karaoke, music, whoosh -> mp4
  upload.py     YouTube Data API v3 resumable upload (OAuth refresh token)
work/<video_id>/   every stage writes its intermediates here (inspectable)
```

## How it flows

```
scripts.json ─▶ script ─▶ tts ─▶ align ─▶ visuals ─▶ assemble ─▶ upload
                 │         │       │         │           │          │
             script.json voice.wav align.json scenes/*  final.mp4  upload.json
                                              scenes.json
```

The narration TTS speaks is the concatenation of the scenes' `text`. `align`
times every word; `visuals` slices those timings back into per-scene screen
time (`timing.py`); `assemble` burns the words as karaoke captions in sync.

## Requirements

- **ffmpeg + ffprobe** on `PATH` (built with libx264, aac, libass, zoompan).
- **Python 3.11** and `pip install -r requirements.txt`.
- **Playwright browser** (cards): `playwright install chromium` (once).
- **GPU stages** (optional but recommended):
  - `align` uses faster-whisper `large-v3` (float16, ~4 GB VRAM).
  - `generated` scenes use Flux Schnell via `diffusers` (fits 12 GB with CPU
    offload). Install a CUDA torch build:
    `pip install torch --index-url https://download.pytorch.org/whl/cu121`
- **Pexels API key** (stock scenes, free): `export PEXELS_API_KEY=...`
- **YouTube OAuth** (upload): a Data API v3 OAuth *desktop* client secret.

Models download themselves on first use (Kokoro, whisper, Flux) — no API keys,
no paid services.

## Quick start

```bash
cd faceless
pip install -r requirements.txt
playwright install chromium

# 1) put your scripts in scripts.json  (shape below; a sample is included)
# 2) drop a music bed in assets/music/ and a whoosh in assets/sfx/
# 3) build the next video end-to-end:
python run.py

# inspect intermediates:
ls work/0001_*/            # script.json voice.wav align.json scenes/ final.mp4
```

Upload is **off** by default. Enable it in `config.yaml` (`upload.enabled: true`)
or per-run with `python run.py --upload`.

## scripts.json shape

A JSON list (or `{"scripts": [...]}`). Each script:

```jsonc
{
  "title": "...",                 // internal title (queue key)
  "hook": "...", "beats": ["..."], "payoff": "...", "loop_line": "...",
  "scenes": [
    { "type": "card",      "text": "spoken + shown", "emoji": "🗼",
      "query_or_prompt": "", "headline": "OPTIONAL short card title" },
    { "type": "stock",     "text": "...", "emoji": "🌊",
      "query_or_prompt": "pexels search terms" },
    { "type": "generated", "text": "...", "emoji": "🕯️",
      "query_or_prompt": "flux image prompt, vertical" }
  ],
  "yt_title": "...", "description": "...", "tags": ["..."],
  "pinned_comment": "..."
}
```

- `text` is spoken by TTS **and** captioned. For `card` scenes it's also shown
  on the card — keep it short, or add a `headline` to show something shorter
  than the narration.
- `type`:
  - `card` → Playwright renders `assets/templates/card.html` to a still.
  - `stock` → a portrait Pexels clip for `query_or_prompt` is downloaded.
  - `generated` → Flux Schnell generates a still from `query_or_prompt`.
- If a stock/generated scene can't be produced (no key, no GPU, no result) it
  falls back to a card (`visuals.fallback_to_card`).

## Running stages

```bash
python run.py                       # start & build the next queued script
python run.py --resume              # continue the latest unfinished video
python run.py --video-id 0003_foo   # build/continue a specific video
python run.py --from visuals        # visuals -> assemble (-> upload)
python run.py --only assemble       # just one stage
python run.py --force               # rebuild every selected stage
python run.py --force-stage assemble
python run.py --peek                # what's next in the queue
python run.py --list                # all videos + status
python run.py --status 0001_foo     # per-stage status of one video

# stages also run standalone (handy while iterating):
python -m pipeline.tts       0001_foo
python -m pipeline.align     0001_foo
python -m pipeline.visuals   0001_foo --force
python -m pipeline.assemble  0001_foo --force
python -m pipeline.upload    0001_foo
```

**Resume** is automatic and file-based: a stage is skipped when its primary
output already exists in `work/<video_id>/`. Delete that file (or use
`--force`/`--force-stage`) to redo a stage. So if a run dies halfway, just run
`python run.py --video-id <id>` again.

## Building assemble.py first (the ffmpeg core)

`assemble.py` was built and validated **before** the model stages, against
dummy assets, so the ffmpeg pipeline is provably correct. You can do the same:

```bash
python -m tools.make_dummies dummy     # fake voice/scenes/align + music + sfx
python -m pipeline.assemble  dummy      # renders work/dummy/final.mp4
```

Every ffmpeg command is printed to the console before it runs, and the full
`-filter_complex` is written to `work/<id>/filtergraph.txt` (fed to ffmpeg via
`-filter_complex_script`, so no giant fragile command lines). ffmpeg's stderr
goes to `work/<id>/ffmpeg.log`.

What `assemble` produces:
- each **still** (card/generated) gets a smooth Ken Burns zoompan (stills are
  upscaled first so the motion is sub-pixel smooth); zoom alternates in/out;
- each **stock** clip is scaled/cropped to fill 1080×1920 and looped to length;
- scenes are concatenated in order, timed to the narration;
- **ASS karaoke** captions from `align.json` are burned in (word-by-word);
- a **music bed** is looped and ducked to `audio.music_db` (−20 dB) with fades;
- a **whoosh** fires on every cut (`adelay` per boundary);
- output: H.264 High + AAC, `yuv420p`, `+faststart`.

Encoder is configurable (`video.encoder`): `libx264` (default) or
`h264_nvenc` to use the 4070's hardware encoder.

## Assets (you provide)

Drop files into these folders (git-ignored; first file is used, or name it in
`config.yaml`):

- `assets/music/` — a music bed (mp3/wav/…). Ducked to −20 dB under narration.
- `assets/sfx/`   — a whoosh (short wav/mp3) played on each scene cut.

Use tracks you have the right to use (e.g. YouTube Audio Library, CC0 SFX).

## Upload, kids flag, and synthetic-media disclosure

`upload.py` does a resumable Data API v3 upload and sets:

- `status.selfDeclaredMadeForKids = false`
- `status.containsSyntheticMedia = true` (AI visuals + synthetic voice)

The synthetic-media disclosure is **also appended to the description** as a
fallback, because the API status field isn't honoured on every channel yet; if
the API rejects the field, the upload retries without it (the description note
still carries the disclosure). YouTube may additionally ask you to confirm the
"altered or synthetic content" toggle in Studio.

First upload opens a browser to authorise; the refresh token is cached in
`upload.token_file` and reused after that. `pinned_comment` is saved to
`upload.json` and printed (the API can't pin comments for you).

Configure privacy, category, client-secret/token paths, and the disclosure text
under `upload:` in `config.yaml`.

## Config

`config.yaml` overrides the defaults in `pipeline/config.py`. Point elsewhere
with `--config path.yaml` or `FACELESS_CONFIG=path.yaml`. Keys are documented
inline in `config.yaml` (video/encoder, Ken Burns, tts voice, align model,
visuals, audio mix, captions style, upload).

## Self-test

```bash
python -m tools.selftest      # pure logic: config, state, timing, captions
```

## Troubleshooting

- **`ffmpeg not found`** — install it and ensure `ffmpeg`/`ffprobe` are on
  `PATH` (override with `FFMPEG_BIN`/`FFPROBE_BIN`).
- **Playwright can't find Chromium** — run `playwright install chromium`, or set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a specific Chromium binary.
- **No GPU / models not installed** — set `FACELESS_ALLOW_FALLBACKS=1` to let
  `tts` write a silent placeholder and `align` use even-split timings, so you
  can smoke-test the whole pipeline. Production runs should leave this off so a
  missing model fails loudly instead of shipping a broken video.
- **Captions clipped** — lower `captions.font_size` or `captions.max_words_per_line`.
```
