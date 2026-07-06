# Shorts Studio

A fully native, self-improving YouTube Shorts creator. One command researches what's
moving in your niche, scores ideas with a **dynamic formula**, writes retention-engineered
scripts with Claude, voices them locally, renders branded 1080×1920 video with karaoke
captions, schedules uploads to **two channels** at peak slots — and then reads its own
analytics to update the formula.

**Read [`RESEARCH.md`](RESEARCH.md) first** — it's the market research (15 reference
videos + platform mechanics) that every design decision here traces back to.

```
research ─▶ ideate ─▶ script ─▶ voice ─▶ captions ─▶ render ─▶ review ─▶ publish
   ▲            (formula S1)      (formula S2 gate)              (human)     │
   └───────────────────────  analytics: weights update  ◀────────────────────┘
```

External runtime dependencies: **Anthropic API** (research + scripts) and
**YouTube API** (upload + analytics). Voice, visuals, captions, and rendering are
all local and free.

---

## Understand the platform in 60 seconds (the model this system optimizes)

1. Every Short is tested on a **seed audience** (~50–500 viewers, mostly non-subscribers).
2. The gate is **retention**: ≈65 % average view for <30 s Shorts, ≈50 % for 30–60 s.
   Pass → wider push. Fail → the video dies *and* channel trust drops.
3. **Loops count as re-watches** — a strong satisfaction signal (hence the loop line).
4. Monetization: 500 subs → fan funding; 1 000 subs + 10 M Shorts views/90 d → **45 %**
   of pooled ad revenue by view share. RPM is $0.01–$0.30 depending on **niche + geo**
   — which is why niche selection is a scored input, not an afterthought.
5. Since July 2025, **mass-produced AI content is demonetized** ("inauthentic content").
   Every guard in this system (originality validator, novelty check, own visual style,
   human approval, disclosure) exists because of that policy.

## Quick start (10 minutes, zero YouTube setup needed)

```bash
cd studio
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # research + upload deps
pip install -r requirements-voice.txt    # local TTS (Kokoro) — recommended
cp .env.example .env                     # add your ANTHROPIC_API_KEY
python run.py doctor                     # see what's ready
python run.py sample                     # renders a free style preview per channel
```

`sample` uses the mock voice and no APIs — you can see each channel's look immediately
in `data/renders/`.

## Produce your first real videos

```bash
python run.py research          # Claude + web search -> scored topic candidates
python run.py produce           # script -> gate -> voice -> render (review queue)
python run.py review            # watch them; then:
python run.py review approve 1
python run.py review reject 2 --reason "hook is weak"
```

The formula gate (`script_threshold`) is allowed to output **nothing** — a weak Short
hurts the channel more than no Short.

## Publish (two channels)

One Google account can own multiple channels (brand accounts). Setup per channel:

1. Create a **separate Google Cloud project per channel** (doubles your free upload
   quota — `videos.insert` costs 1600 of the 10 000 daily units, ≈6 uploads/day/project
   — and isolates audits). Enable *YouTube Data API v3* and *YouTube Analytics API*.
2. Create an OAuth client (Desktop app), download the JSON to
   `secrets/channel_a_client_secret.json` (path set in `config.yaml`).
3. `python run.py auth channel_a` — sign in **as that channel** when Google asks.
4. `python run.py publish` — approved videos are uploaded private + scheduled into
   the next free peak slot (12:30 / 19:30 viewer-local by default).

**Important platform reality:** uploads from API projects that haven't passed
YouTube's free **API audit** are locked private. Two ways to run:
- Submit the audit form once (YouTube API Services — Audit and Quota Extension);
  after approval, scheduled publishing is fully hands-off.
- Until then: uploads still land in your channel fully titled/tagged/scheduled —
  flip visibility in YouTube Studio from your phone (~10 s), or set
  `publishing.mode: export` to get ready-to-post folders in `data/outbox/` instead.

## Close the loop (this is what makes the formula dynamic)

```bash
python run.py analyze     # pulls views/retention per video, updates learned priors
```

Performance index `P = 0.6·retention + 0.3·reach + 0.1·engagement` updates an EMA
prior for every (hook_type, format, length) combination. Future ideas that match
what *your* audience retains get scored up; 20 % of slots still go to exploration
(`formula.epsilon`) so the system keeps discovering. Details: `RESEARCH.md` §3.

## Daily automation

```bash
python run.py run         # research -> produce -> publish approved -> analyze, all channels
```

Cron it (laptop/server/Raspberry Pi — everything runs on CPU):

```cron
30 9 * * *  cd /path/to/studio && .venv/bin/python run.py run >> data/run.log 2>&1
```

With `review.required: true` (default), the cron run produces + schedules but the
review step stays yours: check the queue once a day, approve, done. That human pass
is deliberate — it's your quality gate *and* your policy shield.

## Configuration

Everything lives in [`config.yaml`](config.yaml) — channels (niche, persona, voice,
visual theme, posting slots, timezone), formula weights, cadence, review, publish mode.
Themes: `midnight`, `ember`, `forest`, `steel`, `royal` (`app/visuals.py`) — every
video gets a seeded color jitter so it's unique but on-brand.

## Costs at the free tier

| Thing | Cost |
|---|---|
| Voice (Kokoro local) / visuals / captions / render | $0 |
| YouTube upload + analytics APIs | $0 (quota-limited) |
| Claude (research + 2 scripts/channel/day) | ~cents/day; the only real cost |

## Testing

```bash
python -m pytest tests/ -q     # 41 offline tests; render tests use real ffmpeg
```

No test touches the network. Claude is faked, TTS is mocked, publishing is tested in
export mode.

## Layout

```
studio/
├── run.py            # CLI: doctor sample research produce review publish analyze run auth status
├── config.yaml       # channels + formula + cadence
├── RESEARCH.md       # the market research this system is derived from
├── app/
│   ├── formula.py    # the dynamic scoring formula + learning (start here)
│   ├── research.py   # Claude + web search -> trend candidates
│   ├── ideate.py     # stage-1 scoring & epsilon-greedy selection
│   ├── scriptgen.py  # structured scripts + the retention-contract validator
│   ├── voice.py      # kokoro / edge / mock TTS with word timings
│   ├── captions.py   # karaoke .ass subtitles
│   ├── visuals.py    # procedural themes (gradient/grain/vignette/progress bar)
│   ├── render.py     # ffmpeg assembly -> 1080x1920 h264
│   ├── metadata.py   # titles/descriptions/tags + AI disclosure
│   ├── review.py     # human approval gate
│   ├── publish.py    # 2-channel scheduled uploads, quota-aware; export mode
│   ├── analytics.py  # metrics pull -> formula weight updates
│   ├── pipeline.py   # orchestration + sample renderer
│   ├── ledger.py     # SQLite source of truth (idempotent everything)
│   └── config.py
└── tests/            # offline suite
```
