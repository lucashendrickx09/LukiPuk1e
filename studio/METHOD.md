# The 100K Method

The operating manual for reaching **100,000 subscribers and full monetization**,
built from everything in `RESEARCH.md` and enforced — not just described — by the
pipeline. The dashboard (`python run.py web`) tracks every number in this document
live and visualizes the pipeline below.

---

## 1. The goal, in platform math

100K subs is a **views problem wearing a subscriber costume**. Shorts convert
views→subs at roughly 0.2–1% depending on how strongly the channel promises
"more of exactly this". At a working average of ~0.4%:

| Milestone | Subs needed | Cumulative views (≈0.4% conv.) | What unlocks |
|---|---|---|---|
| Tier 1 monetization | 500 | ~125K | fan funding |
| Tier 2 sub requirement | 1,000 | ~250K | half of revenue share |
| Tier 2 full | 1,000 + 10M views/90d | 10M in a rolling window | **45% ad share — paid** |
| The goal | 100,000 | ~25M | silver button, real RPM income |

Two levers exist and only two: **more retained views per video** (the algorithm
multiplies reach when retention clears the gate) and **more videos** (2/day/channel,
never at the cost of the gate). Everything below is those two levers.

## 2. Retention engineering — why viewers stay (the entertainment core)

The seed audience decides everything in the first sessions. The method attacks
each second of a Short:

**Seconds 0–1 (the swipe decision).** The hook card is on screen at frame 0 before
a word is spoken; the hook itself is ≤12 words with a number or named entity and
an unresolved gap ("Broke at 44. Billionaire by 67. *How?*"). Punch-in motion makes
the frame feel alive even paused.

**Seconds 1–8 (the commitment window).** First beat must escalate, not restate.
Caption chunks bounce in every ~0.8s; the first emoji pops; the first scene cut
lands by second 4. Nothing on screen sits still for more than 2 seconds — this is
the "engineered" cadence the reference creators measure.

**Middle (the sag zone).** Beats strictly escalate (each raises stakes or sharpens
the claim); every beat gets its own scene, so the eye gets a new object exactly when
attention would dip. Numbers render oversized. The progress bar quietly promises
"almost done — stay".

**The last 3 seconds (the loop).** The payoff pays the hook's promise concretely,
then the loop line reads as a re-entry ("And at 44, everyone thought Sam was
finished."). Loops register as re-watches — retention >100% on the best videos.

**Entertainment inside the theme.** Staying on-brand isn't a constraint on
entertainment, it *is* the entertainment: every video is a mini-heist story
(setup → the moment it almost died → the mechanism → the number). Broke to
Billions tells it about money; Brain Glitch tells it about your own head. Both
use the same dramatic engine.

## 3. The production method (what the AI executes per video)

Visualized live on the dashboard. Ten steps, each with an enforced rule:

```
RESEARCH ▸ SCORE ▸ SCRIPT ▸ GATE ▸ VOICE ▸ SCENES ▸ ASSEMBLE ▸ REVIEW ▸ PUBLISH ▸ LEARN
   │         │        │       │      │        │         │          │        │        │
 live web  S1 =     hook≤12  S2 <  kokoro   noir     punch cuts  human/   peak    priors +
 search,  trend+RPM  beats↑  thresh word    scenes,  captions    auto     slots,  Claude
 original +novelty  payoff  = cut  stamps   emoji,   emoji pops  floor    comment weekly
 angles   +prior    loop           1.08x    numbers  SFX  <2s                     deep dive
```

The LEARN step is what makes the method *optimized over time* rather than static:
every published video's retention updates the priors that pick the next topics
(EMA, α=0.3), and the weekly Claude deep-analysis (`diagnose` / dashboard button)
reads the whole operation and prescribes concrete fixes.

## 4. The weekly operating rhythm

- **Daily (5 min):** review queue → approve/reject. Rejects with reasons teach you
  what the gate misses.
- **Every publish:** automatic — slotting, comment, analytics collection.
- **Weekly (15 min):** run the deep analysis; apply at most **one or two** of its
  recommendations. One variable at a time, or you can't attribute the change.
- **Every 2 weeks:** check the priors table on the dashboard — when a hook_type or
  format holds a prior >0.6 with n≥5, add two seed topics that feed it.

## 5. Stage plan to 100K

| Stage | Cadence | Review | The one thing that matters |
|---|---|---|---|
| 0–500 | 2/day | 100% human | Retention ≥65%. Nothing else. Kill weak hooks mercilessly |
| 500–1K | 2/day | autopilot ≥0.72, review the rest | Consistency; the algorithm is learning your audience |
| 1K–10K | 2–3/day | autopilot + spot checks | Views volume for the 10M/90d requirement; lean on priors |
| 10K–100K | 3/day | autopilot | Series ("Broke #47"), recognizable recurring formats, comment-driven topics |

**Stage-advance rule:** move up only when the trailing-14-video average retention
holds above the gate. Volume before retention is how channels die in the seed pool.

## 6. Failure playbook (pre-decided responses, no panic)

| Signal (dashboard shows it) | Response |
|---|---|
| Retention <50% on 5 straight | Hooks are over-promising or beats sag — run deep analysis, A/B two hook types via epsilon=0.3 for a week |
| Views flat but retention >65% | Patience — seed pools are small pre-1K subs; check posting slots match audience timezone |
| Retention high, subs not converting | The channel promise is fuzzy — tighten titles to the brand convention, pin comment should ask a "follow for X" adjacent question |
| Discard rate >50% at the gate | Niche wording too narrow for research — broaden seed topics, don't lower the threshold |
| A format's prior collapses | Audience fatigue — the epsilon exploration slot exists exactly for this; let it hunt |

## 7. Tools (all visible on the dashboard's Toolchain panel)

ffmpeg (render) · Kokoro TTS (voice) · Pillow (scenes/brand) · Noto Color Emoji
(emoji layer) · Claude API (research, scripts, deep analysis) · YouTube Data +
Analytics APIs (publish, learn) · SQLite ledger (memory) · this repo (everything).
