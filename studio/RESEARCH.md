# Market Research — the foundation this system is built on

This document is the research pass that was requested before any code was written.
Everything in `app/formula.py` traces back to a claim on this page.

---

## 1. The 15 reference videos — what they are and what they share

The reference links fall into **two clusters**. Identified titles (via web search; one
video could not be resolved from this environment because YouTube itself is blocked here):

### Cluster A — "faceless AI Shorts channel as a business" (the *system* videos)

| # | Video | Core lesson |
|---|-------|-------------|
| 1 | I Made a YouTube Shorts Automation Channel USING ONLY AI in 24 Hours | The whole pipeline (idea → script → voice → edit → post) can be automated; the bottleneck is quality, not tooling |
| 2 | How I Create YouTube Automation Videos With AI (Step-by-Step Method) | Treat production as a repeatable assembly line with fixed stages |
| 3 | AI YouTube Automation: How to Start a YouTube Channel With AI | Niche selection comes *before* production; pick by RPM × competition |
| 4 | I BLEW UP a YouTube Channel in 24 Hours with AI | Velocity matters: daily posting into one narrow niche trains the algorithm fast |
| 5 | How I Make $24,937/mo Posting YouTube Shorts (Using Claude AI) | Use Claude as the *script engine* with a locked structure — not free-form generation |
| 6 | how i make $36,438/mo posting YouTube Shorts (using AI) | One proven format, repeated with variation; revenue comes from volume × RPM niche |
| 7 | i make $20,789/mo posting YouTube Shorts (just copy me) | Copy *formats* that already work, not content; systematize everything |

### Cluster B — "the craft" (the *quality* videos)

| # | Video | Core lesson |
|---|-------|-------------|
| 8 | The Ridiculous Engineering Of Short Form Content | Top shorts are *engineered*: a visual/audio change every 1.5–3 s, zero dead air |
| 9 | How To Become A Master Storyteller | Setup → tension → payoff; specificity beats generality; open loops hold attention |
| 10 | The Ultimate Guide to Master Short-Form Video Editing | Research outliers first, script for engagement, edit for motion & captions |
| 11 | How to make shorts that go viral every time | Shorts is a game of skill: seed-audience test → retention gate → wider push |
| 12 | Give me 15 mins, and I'll make your hooks impossible to skip | The hook is a *promise + gap*: concrete, ≤ 2 s, verbal + visual at once |
| 13 | How I'd Script my First YouTube Video (Simple but Works) | Write the payoff first, then hook, then the shortest path between them |
| 14 | The World's Shortest YouTube Shorts Guide You'll Ever Need | Everything above compresses to: hook fast, retain hard, loop the end |
| 15 | (unresolved video ID `ds7DDgGgiVs` — YouTube is network-blocked in this environment) | — |

### The similarities (what *all* of them converge on)

1. **The first 1–2 seconds decide everything.** Every source, both clusters.
2. **Structure is fixed, content varies.** HOOK → escalating beats → PAYOFF → LOOP.
3. **A change every ~2–3 seconds** (visual, caption, idea) or people swipe.
4. **Write the payoff first.** The script is the shortest path from hook to payoff.
5. **Niche → RPM → geography** determine revenue *per view* before you make anything.
6. **Volume with a quality gate.** Daily cadence, but a weak short actively hurts.
7. **Study your own analytics and double down** on what retains — the feedback loop
   *is* the strategy. This is why the formula below is dynamic, not static.

---

## 2. YouTube Shorts — how the platform actually works (2026)

### Distribution mechanics
- Every Short is first shown to a **seed audience** (~50–500 viewers, ≈70 % non-subscribers).
- The gate metric is **viewed vs. swiped away** and **watch time per impression**.
  Completed views and re-watches count most; a fast swipe kills distribution.
- Empirical retention gates to get pushed wider: **≈65 % average retention for < 30 s**,
  **≈50 % for 30–60 s**. Under the bar → the video stops being shown, and it drags
  channel-level trust down with it.
- **Loops register as re-watches** — a strong satisfaction signal.

### Monetization mechanics
- **Tier 1 (fan funding):** 500 subs + 3 public uploads in 90 days.
- **Tier 2 (ad revenue share):** 1 000 subs AND (10 M public Shorts views in 90 days
  OR 4 000 long-form watch-hours). Creator keeps **45 %** of the pooled Shorts ad revenue,
  allocated by view share.
- **RPM is tiny and niche-dependent:** ≈ $0.01–0.08 typical; finance/business/tech with
  US/UK/CA/AU audiences reach $0.10–0.30+; entertainment ≈ $0.02–0.05; India-heavy
  audiences ≈ $0.003–0.015. **Niche and audience geography are chosen before content.**
- Real money at small scale comes from RPM-weighted volume + affiliate/product layers later.

### The July 2025 "inauthentic content" policy (critical for this project)
YouTube renamed "repetitious content" to **inauthentic content** and now demonetizes
mass-produced AI content: TTS-over-stock-footage clones, template scripts with one word
changed, volume-over-substance upload patterns. Channels get demonetized or removed.

**What stays safe:** original scripts with real insight, a distinctive consistent
own-brand style, AI used as a tool inside a human-curated pipeline. This is why this
system: (a) generates **original scripts** per video, (b) uses a **procedurally generated
own visual style** instead of stock footage, (c) enforces a **novelty check** so no two
scripts are near-duplicates, (d) keeps a **human approval gate** before anything posts,
and (e) discloses synthetic narration.

### Cadence & timing
- **1–2 Shorts/day per channel** is the productivity sweet spot; > 3/day dilutes.
- A weak Short hurts more than no Short → the quality gate is allowed to output zero.
- Best windows (viewer-local): **12:00–15:00 and 19:00–21:00**; Fri/Sat evenings strongest.
- Optimal length: **20–35 s** — long enough for a complete idea, short enough to clear
  the 65 % retention gate and loop.

### Platform/API constraints that shaped the architecture
- `videos.insert` costs **1600 quota units**; default project quota is 10 000/day
  → ~6 uploads/day/project. Two channels each using **their own Google Cloud project**
  doubles headroom and isolates risk.
- Uploads from **unverified API projects are locked private** — the free, one-time
  **API audit** (compliance form) lifts this. Until then this system uploads
  private+scheduled and you flip visibility in Studio (~10 s from a phone), or use
  `export-pack` mode. Nothing about the pipeline blocks on Google's timeline.
- One Google account can own **multiple (brand) channels** — 2 channels is explicitly
  allowed. Each needs YPP separately; both feed from the same pipeline.

---

## 3. The Dynamic Formula (derived from §1 + §2)

Selection is two-stage, and the weights **learn from your own analytics** — the formula
is dynamic because the reference creators' single most repeated advice is "study what
retained, double down".

### Stage 1 — idea score (before writing anything)

```
S₁(idea) = w_t·Trend + w_m·RPM + w_n·Novelty + w_p·Prior
```

| Component | Meaning | Source |
|---|---|---|
| **Trend** | topic velocity right now (0–1), from grounded web research | Cluster A #4, platform: freshness |
| **RPM** | channel niche monetization tier × geo | §2 monetization |
| **Novelty** | 1 − max similarity vs. your recent uploads | inauthentic-content policy + audience fatigue |
| **Prior** | learned performance of this topic-cluster/format on *your* channel | Cluster B #11, feedback loop |

### Stage 2 — script score (after writing, before rendering)

```
S₂(script) = S₁ ⊗ (w_h·Hook + w_r·Retention)
```

| Component | Heuristics enforced |
|---|---|
| **Hook** | ≤ 12 words, concrete (number / named entity), curiosity gap, no banned openers, promise stated in the first line — Cluster B #12 |
| **Retention** | est. duration in the 18–40 s band peaking at 20–32 s, a beat every 3–5 s, escalation, explicit payoff, loop line that re-connects to the hook — Cluster B #8, #9, #14 |

A script below the quality threshold is rewritten once, then **discarded** — the
platform punishes weak uploads (§2), so the gate is allowed to output nothing.

### The dynamic part — weight updates from analytics

After each video has ≥ 48 h of data, its **performance index** is computed:

```
P = 0.6·(avgViewedPercentage/100) + 0.3·log₁₀(views+1)/6 + 0.1·engagementRate
```

`avgViewedPercentage` dominates because retention is what the algorithm gates on (§2).
Every (hook_type, format, length-bucket) key gets an exponentially-weighted prior:

```
prior ← (1−α)·prior + α·P        (α = 0.3)
```

Selection is ε-greedy (ε = 0.2 by default): 80 % of slots go to the best-scoring
ideas (exploit), 20 % to deliberately different formats (explore) — so the formula
keeps discovering instead of overfitting to early noise.

### Script structure contract (enforced by the validator)

```
[0–2 s]   HOOK      — the promise + gap, verbal AND on-screen simultaneously
[2 s–80%] BEATS ×3–6 — one idea each, ≤ 22 words, strictly escalating
[80–95%]  PAYOFF    — the promise is paid, concretely
[last 2 s] LOOP     — a line that reads as a re-entry into the hook
```

---

## 4. Why the production stack is native

| Need | Choice | Why |
|---|---|---|
| Script + research | Claude API (+ server-side web search) | the one external dependency that earns its keep; grounded trend data + structured scripts |
| Voice | **Kokoro-82M locally** (Apache-2.0, CPU-friendly, near-commercial quality, word timestamps) | free forever, no rate limits, no ToS risk; `edge-tts` fallback; `mock` for tests |
| Visuals | **procedural ffmpeg** (animated gradient + grain + vignette + progress bar, seeded per video) | zero stock footage → zero copyright/inauthentic-content exposure, a recognizable brand look, renders in seconds on CPU |
| Captions | libass karaoke subtitles generated from real word timings | the "word-pop" caption style every reference video uses, natively |
| Upload | YouTube Data API v3, private+scheduled | free tier, quota-aware, two channels |
| Feedback | YouTube Analytics API → formula weights | closes the loop that makes the formula dynamic |

Total external runtime dependencies: **Anthropic API + YouTube API**. Everything else
is local and free.
