# Stockpile (working title)

A mobile investing companion that ingests market news, analyst ratings, company
filings, and newsletter/social chatter, processes it into explained stock theses,
and serves them as a daily Tinder-style swipe deck — alongside a personal
portfolio tracker.

**Status:** v0.1 shipped (2026-06-12), extended 2026-06-17 with portfolio
**Suggestions** and **Folders** (a fifth tab). See *Running the app* below.

---

## Running the app

You can't run a React Native app straight off a GitHub page like a website — it
has to be bundled and run in a mobile runtime. Two real paths:

### Option A — install it on your phone from GitHub (no dev setup), via EAS

This builds a real installable app in Expo's cloud from this repo.

1. Create a free account at [expo.dev](https://expo.dev).
2. Install the CLI: `npm install -g eas-cli`, then `eas login`.
3. From the repo root: `eas init` (links it to your Expo account and writes the
   project id), then `eas build -p android --profile preview`.
4. Expo builds in the cloud (~10–15 min) and gives you a link to an **APK** —
   open it on an Android phone to install. (`eas.json` ships a `preview` profile
   that produces an APK.)
5. iOS has no sideloadable equivalent: use Option B with Expo Go, or
   `eas build -p ios` + TestFlight (needs a paid Apple Developer account).

> Prefer no local CLI at all? In the Expo dashboard you can connect this GitHub
> repo and trigger the same build from the web.

### Option B — run it locally with Expo (dev mode)

Prerequisites: Node 20+, and **Expo Go** on your phone (App Store / Play Store).

```bash
npm install
npx expo start        # add --tunnel if phone and computer aren't on one network
```

Scan the QR with Expo Go (Android) or the Camera app (iOS).

Either way, the app starts in **demo mode** — every screen works with
illustrative data. To go live, add keys in **Settings**:

1. **Finnhub** (free): sign up at [finnhub.io](https://finnhub.io) → copy your
   API key. Unlocks live quotes, analyst trends, news, profiles — and real deck
   builds (a build takes ~2 minutes on the free tier's rate limit).
2. **Anthropic** (~$1–5/month at default settings): create a key at
   [console.anthropic.com](https://console.anthropic.com). Unlocks Claude-written
   theses on each card; without it the app generates template theses from the
   raw signals.

Keys are stored in the device keychain and sent only to Finnhub/Anthropic.

### Code map

```
src/app/        screens (expo-router): (tabs)/ portfolio·discover·catalog·folders·settings,
                company/[symbol] detail, folder/[id] detail, add-position modal
src/engine/     analysis pipeline (signals → gate → scoring → personalization →
                thesis) + recommend (portfolio suggestions). Pure TS, lifts to a server in v0.2
src/api/        finnhub · stooq (price history) · EDGAR (filings) · anthropic
src/store/      zustand stores persisted to AsyncStorage (portfolio, deck, catalog,
                folders, settings, market cache)
src/components/ swipe deck (core Animated, no native deps) + hand-rolled SVG charts
```

---

## Product decisions (from founder interview)

| Area | Decision |
|---|---|
| Platform | Cross-platform mobile: **React Native + Expo** (TypeScript) |
| Audience | Personal tool now, architected to go **public later** |
| Markets | **US stocks (NYSE/NASDAQ) + ETFs/funds** — EU stocks deferred |
| Portfolio data | **Manual entry** of positions; broker sync deferred |
| Base currency | **USD** |
| Analysis engine | **Hybrid pipeline**: cheap structured signals shortlist candidates, an LLM deep-reads sources only for the shortlist and writes the thesis |
| Budget | **Free-tier data APIs**; LLM usage is the only paid component (~$1–5/month at daily-deck volume, Haiku-class model) |
| Freshness | **Daily deck** built by an overnight batch; portfolio prices refresh live-ish (every few minutes while app is open) |
| Sources | All four types: mainstream finance news, analyst ratings & targets, SEC filings & company releases, newsletters & social |
| Investing style | Dual scoring: **long-term buy & hold** + **growth & momentum**; every card shows both scores |
| Deck bar | **Moderate**: 2+ independent source *types* must align within the lookback window (~5–10 cards/day) |
| Personalization | Swipes train the deck (sector / cap-size / style weighting), but every card carries a **"why you're seeing this"** tag — no black box |
| Notifications | Daily deck ready · portfolio moves (±5%) & news on owned stocks · major updates on catalogued stocks |
| Backend | **Supabase** (Postgres + auth-ready + storage) with a scheduled worker (cron) running the nightly pipeline |
| v0.1 scope | **Thin slice of all four screens** end-to-end, then deepen iteratively |

---

## The screens

### 1. Portfolio
Tracks every position the user entered manually (ticker, shares, buy price, buy date).

- Header: total value, total P/L ($ and %), day change.
- **Suggestions** — cross-references holdings against the catalog: flags
  underperformers to review, sector concentration, strong catalog picks you
  don't own, and possible rotations (worst holding → best cross-sector pick).
  Educational only, not advice; each suggestion deep-links to the company.
- Holdings list: per-position price, P/L, day move, sparkline.
- Visual breakdowns: allocation by **industry/sector**, by **market-cap size**
  (mega/large/mid/small), by **profit percentage** (winners vs losers), and
  portfolio-value-over-time chart.
- Prices poll every few minutes while the app is foregrounded (free-tier quote API).

### 2. Discover (swipe deck)
The daily deck of companies the pipeline found "semi-agreeable potential" in.

Each card shows:
- Company logo + a representative visual (v0.1: logo on a sector-themed card design).
- Main selling point / appeal — one LLM-written hook sentence.
- Current stock price + day move.
- Market/sector, and a recognizability indicator (market cap tier + "how well known").
- Style scores: long-term score and momentum score.
- The **"why you're seeing this"** tag (e.g. "2 analyst upgrades + earnings-beat
  coverage this week" or "matches your right-swipes in semiconductors").

Mechanics:
- **Swipe right** → company enters the Catalog.
- **Swipe left** → discarded with a **21-day cooldown**; it may reappear sooner
  only if a *new* major catalyst fires, and always with a fresh thesis.
- Deck entry rule: signals from **≥2 independent source types** (e.g. analyst
  upgrade AND positive news coverage) within the 7-day lookback window.
- Swipe history feeds the personalization weights (transparent, see above).

### 3. Catalog
Everything swiped right, persisted as a research shortlist.

- Grid/list of catalogued companies with price + change at a glance.
- **Long-press** → quick-peek sheet: one-paragraph "what they do" + key stats.
- **Tap** → full detail view:
  - Price history charts (1W/1M/1Y/5Y), valuation + fundamentals stats,
    analyst consensus, recent news timeline.
  - The recommendation thesis: why it surfaced, what they do, and the LLM-written
    **bull case / bear case** ("why you should or shouldn't buy").
  - Source receipts: links to the actual articles/filings/ratings behind the thesis.
- Catalogued stocks are monitored: major news/earnings/thesis-changing events
  trigger a push notification.
- **Long-press → Folders**: assign the stock to any number of folders, or spin
  up a new folder inline.

### 4. Folders
Organize catalogued stocks into named groups (e.g. "AI", "Dividends", "Watch
closely").

- List of folders, each previewing its holdings; **tap** opens the folder, with
  live prices per stock and tap-through to the full company analysis.
- Create / rename / delete folders; remove a stock with a long-press. Removing a
  stock from the catalog automatically prunes it from every folder.

### 5. Settings & utility
- Deck tuning: strictness (1/2/3+ sources), cards per day, style filter
  (long-term vs momentum lean), reset personalization.
- Notification toggles (deck ready / portfolio alerts / catalog alerts) and
  portfolio move threshold.
- Watched sources management (enable/disable feeds, add RSS/newsletter URLs).
- Display: theme, currency display options.
- Data: export/erase local data. (Auth/account section arrives in the public phase.)

---

## Intelligence pipeline (nightly batch)

```
ingest → extract & tag tickers → score signals → consensus gate (≥2 source types)
      → personalization weighting → LLM thesis writer (shortlist only) → publish deck
```

1. **Ingest** (free sources):
   - News: Google News RSS per-ticker/sector queries, CNBC/MarketWatch/Yahoo
     Finance RSS, Finnhub free company-news endpoint.
   - Analyst signal: Finnhub free *recommendation trends* (buy/hold/sell counts,
     upgrades/downgrades deltas).
   - Filings & releases: SEC EDGAR submissions + full-text APIs (free, official) —
     8-K, 10-K/Q, earnings releases, guidance changes.
   - Newsletters & social: user-added newsletter RSS feeds, Reddit JSON endpoints
     (r/stocks, r/investing), StockTwits public sentiment.
2. **Score** each company per source type: mention velocity, sentiment direction,
   analyst-consensus delta, filing-event significance.
3. **Consensus gate**: keep companies where ≥2 *independent source types* align
   positively in the window. Output: ~10–25 candidates.
4. **Personalize**: re-rank by swipe-history weights; attach the transparency tag.
5. **LLM thesis writer** (Haiku-class, the only paid step): for the top ~10, read
   the underlying articles/filings and write the hook line, what-they-do blurb,
   bull case, bear case, and dual style scores with citations.
6. **Publish**: write deck to Postgres, fire the "deck ready" push.

A lighter intraday job (every few hours) only watches **owned + catalogued**
tickers for alert-worthy events — it does not rebuild the deck.

### Free-tier reality check
- Quotes/fundamentals/logos/news: **Finnhub free** (60 calls/min) covers quotes,
  company profile (incl. logo URL), recommendation trends, and company news.
- Historical candles for charts: **Twelve Data free** (800 req/day) or Stooq EOD.
- EDGAR, RSS, Reddit, StockTwits: free.
- **The LLM step cannot be free** — no usable free LLM API exists. At ~10 theses
  + alert summaries per day on a Haiku-class model this is roughly **$1–5/month**.
  This is the single budget exception, accepted in the interview.

---

## Architecture

- **App**: Expo (React Native, TypeScript), Expo Router for the 4-tab layout,
  React Native Skia / Victory Native for charts, gesture-handler + reanimated for
  the swipe deck, Expo Notifications for push.
- **Backend**: Supabase — Postgres (positions, deck cards, swipes, catalog,
  theses, source documents, signal scores), Row Level Security ready for the
  multi-user public phase, scheduled Edge Functions (or a small worker) for the
  nightly pipeline and intraday alert watcher.
- **Auth**: none in v0.1 (single user); Supabase Auth flips on for the public phase.

### Public-phase notes (deferred, but architected for)
- Multi-user via RLS; per-user decks, swipes, portfolios.
- Compliance: reframe "should you buy" language as educational bull/bear analysis
  with "not financial advice" disclaimers; review data-API licensing (free tiers
  are typically personal-use only).
- Replace free feeds with licensed equivalents; add broker sync (e.g. Plaid /
  SnapTrade) as the portfolio upgrade.

---

## Roadmap

- **v0.1 — thin slice (✅ shipped)**: all four screens working end-to-end —
  manual portfolio with live quotes + breakdown charts (sector/holding donuts,
  P/L bars, 3-month value line); the analysis pipeline on the reduced source set
  (Finnhub recommendation trends + company news + EDGAR 8-K check) feeding a
  real swipe deck with the 2-source consensus gate, 21-day left-swipe cooldown,
  taste weighting with "why you're seeing this" tags, and Claude-written theses
  (template fallback without a key); catalog with quick-peek and full detail
  view; settings with keys, deck tuning, and notification preferences.
  *v0.1 simplification:* the pipeline runs **on-device when you open Discover**
  rather than on a nightly server — same logic, different trigger; it lifts into
  the Supabase scheduled function in v0.2 unchanged.
- **v0.2**: full source set (RSS newsletters, Reddit, StockTwits), personalization
  weights live, intraday alert watcher + all three push types, richer infographics.
- **v0.3**: deck tuning UI depth, card visuals upgrade, portfolio analytics
  (FX-impact display, dividend tracking for ETFs).
- **Public phase**: auth, compliance pass, licensed data, broker sync, app-store
  release.
