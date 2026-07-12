# Launch runbook

Everything is built and tested. This is the exact sequence for launch day and the
first month. Nothing here requires decisions — just execution. Check items off.

---

## Phase 0 — first hour at the computer

```bash
git clone https://github.com/lucashendrickx09/LukiPuk1e.git
cd LukiPuk1e && git checkout claude/short-form-video-creator-d02uf9
cd studio
bash setup.sh                # venv + deps + .env template + doctor
```

- [ ] Edit `.env`: add your `ANTHROPIC_API_KEY` (console.anthropic.com → API keys)
- [ ] `source .venv/bin/activate && python run.py doctor` — everything except
      channel auth should be green
- [ ] `python run.py sample` — first render on your machine. **Note:** the first
      run with Kokoro downloads ~330MB of model weights from HuggingFace (one time).
- [ ] Watch both samples in `data/renders/`. Check on your **phone** — colors and
      caption sizes read differently there. Tweaks live in `config.yaml`
      (`theme`, `voice`, `voice_rate`).

Voice options if the defaults don't fit the brand: `af_heart`, `af_bella`,
`af_nicole` (US female), `am_michael`, `am_adam`, `am_onyx` (US male),
`bf_emma`, `bm_george` (British). One line in `config.yaml` per channel.

## Phase 1 — first real content (same day, ~30 min + API cost of a few cents)

```bash
python run.py research        # live trend research per niche
python run.py produce         # scripts -> gate -> voice -> scenes -> renders
python run.py review          # watch them
```

- [ ] Judge 3–4 real videos. This is the calibration moment:
      - Scripts too generic → sharpen `persona` and add specific `seed_topics`
      - Too many discards → check `run.py status` and the events in the ledger;
        lower `script_threshold` only if rejected scripts looked genuinely good
      - Wrong topics → edit the niche wording (it feeds the research prompt directly)
- [ ] `python run.py review approve <id>` for the keepers

## Phase 2 — YouTube plumbing (~45 min once, then a wait you don't control)

Channel setup (both channels, one Google account is fine):
- [ ] `python run.py brand` — generates avatar/banner/watermark + paste-ready copy
      into `data/brand/<channel>/` (identities are defined in BRAND.md)
- [ ] youtube.com → profile → "Create a channel" (brand account) →
      name **Broke to Billions**, handle `@BrokeToBillions` (alternates in BRAND.md
      if taken) → Studio → Customization: upload `avatar.png` + `banner.png` +
      `watermark.png`, paste the description from `ABOUT.txt`
- [ ] Repeat for channel B (**Brain Glitch**, `@TheBrainGlitch`)

Per channel, its own Google Cloud project (doubles quota, isolates audits):
- [ ] console.cloud.google.com → New project (e.g. `shorts-channel-a`)
- [ ] APIs & Services → Enable APIs → enable **YouTube Data API v3** and
      **YouTube Analytics API**
- [ ] APIs & Services → OAuth consent screen → External → add yourself as test user
- [ ] Credentials → Create credentials → OAuth client ID → **Desktop app** →
      download JSON → save as `secrets/channel_a_client_secret.json`
      (exact filenames are in `config.yaml`)
- [ ] `python run.py auth channel_a` — sign in **as that brand channel** when
      Google asks which identity to use
- [ ] Same four steps for `channel_b`
- [ ] **Submit the API audit for both projects now** (search: "YouTube API
      Services - Audit and Quota Extension Form"). Until approval, API uploads
      are locked private — you flip visibility in YouTube Studio (~10s from a
      phone). Submitting on day one starts the multi-week clock immediately.

## Phase 3 — the two-week warmup (manual, ~15 min/day)

Daily:
```bash
python run.py produce && python run.py review     # approve/reject
python run.py publish                             # schedules into peak slots
```
- [ ] After each video passes its publish time: flip it public in YT Studio
      (until the audit clears), confirm the engagement comment posted
- [ ] Day 3+: `python run.py analyze` after videos have views
- [ ] End of week 1: `python run.py diagnose` — read the report, apply at most
      1–2 of its config suggestions (don't thrash settings early)

What "working" looks like at this stage: retention (`avg_view_pct`) trending
toward 60–70% on your best videos. Views will be tiny — that's normal; the
seed-audience test is the game until the algorithm trusts the channels.

## Phase 4 — automation (week 2–3)

- [ ] Cron the daily loop (Mac: System Settings → Energy → schedule wake, or
      keep the lid open on power):
```cron
30 9 * * *    cd ~/LukiPuk1e/studio && .venv/bin/python run.py run >> data/run.log 2>&1
0 13,20 * * * cd ~/LukiPuk1e/studio && .venv/bin/python run.py publish >> data/run.log 2>&1
```
- [ ] Your only daily touch is now `run.py review` (~5 min)
- [ ] When the audit clears: nothing to change — scheduled videos go public on
      their own from then on
- [ ] When you trust the gate (typically after ~20 approvals with few rejects):
      uncomment `review.auto_above: 0.72` in `config.yaml` → full autopilot with
      a human floor

## Phase 5 — steady state (month 2+)

- Keep mission control running: `python run.py web` → open from any device on
  your Wi-Fi. Goals, benchmarks, learned priors, Claude deep analysis — one page.
- Weekly: `run.py diagnose` (or the dashboard's ✦ button) on both channels; act
  on its "Next actions"
- Watch monetization progress in the diagnosis report (500 subs → fan funding;
  1,000 subs + 10M Shorts views/90d → 45% ad revenue share)
- The formula's learned priors get meaningful after ~15–20 published videos per
  channel with >25 views each — expect the system to visibly specialize around
  what retains from week 3–4

## Troubleshooting quick table

| Symptom | Fix |
|---|---|
| `doctor` fails on kokoro | `pip install -r requirements-voice.txt` inside the venv; needs ~2GB disk for torch |
| First produce is slow | Kokoro model download (one time) + torch warmup; subsequent runs are fast |
| Upload fails with `quotaExceeded` | You hit 6 uploads/day on that project — wait for midnight PT or spread across both projects |
| Upload succeeds but video stuck private after publish time | API audit not approved yet — flip in Studio; keep the audit ticket warm |
| Comment posting fails with 403 | Re-run `python run.py auth <channel>` — the token predates the force-ssl scope |
| Research returns nothing | Check `ANTHROPIC_API_KEY` in `.env`; seeds keep production alive meanwhile |
| Emojis missing from videos | Install a color emoji font: `apt install fonts-noto-color-emoji` (macOS has one built in) |
| Videos feel same-y | Raise `formula.epsilon` to 0.3 for a week (more exploration), or add seed topics |

## What was verified before this runbook was written

- 70 offline tests, including real ffmpeg renders of both visual styles
- Full pipeline exercised end-to-end with mock voice + fake Claude in CI-like
  conditions (this sandbox): research → ideate → script gate → scenes → captions
  → SFX → render → review → export-publish → metrics → prior updates
- Not verifiable from the sandbox (network-blocked), so first-run items for you:
  Kokoro model download, real Claude research/scripts, actual YouTube uploads
