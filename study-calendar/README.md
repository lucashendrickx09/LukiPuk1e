# Study Calendar

A personal IBDP summer study calendar — a single-purpose static web app. No auth,
no backend, no database. Everything lives in one editable data file
([`src/plan.ts`](src/plan.ts)) and runs entirely in the browser.

It renders a **real month-grid calendar** (17 Jun → 15 Aug 2026, navigable across
June / July / August). Each day shows small colored dots for the subjects studied
that day and a ★ for sport events. Tap a day to open its full study guide:
topics, "what to do", exam-focused debriefs, and video links.

![Calendar grid](docs/screenshot-grid.png)
![Day modal](docs/screenshot-modal.png)

---

## Features

- **Month-grid calendar** with prev/next month navigation (Jun → Aug 2026).
- **Per-day study guide modal**: subject pill, topic + time, "what to do",
  a highlighted **Debrief** callout (exam tip), and video buttons that open in a
  new tab.
- **Subject colors** as dots on each day; **★** marks days with a sport event.
- **Special day types**: rest days (green, "recover"), holiday 7–11 Jul (amber,
  "fully off"), visitor week 30 Jun–6 Jul (purple, light study only).
- **Video links** are YouTube *search* URLs scoped to trusted IB channels, so they
  always resolve to current results — and they're data-driven, so you can swap in
  specific video URLs later.
- **Completion tracking**: tick off each study block; state persists to
  `localStorage`, with a per-week progress bar.
- **Subject filter + legend**: tap a subject to show/hide its dots on the grid.
- **Today highlight**, **keyboard support** (Esc closes the modal), click-outside
  to close, smooth modal animation.
- **Mobile-responsive** — works as a real calendar on a phone.

## Tech stack

Vite · React · TypeScript · Tailwind CSS v4 · date-fns. Builds to a static
`dist/` folder you can host anywhere.

---

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
```

Build and preview the production bundle:

```bash
npm run build    # type-checks, then outputs static files to dist/
npm run preview  # serve the built dist/ locally to sanity-check
```

> **Note on `--configLoader runner`:** the npm scripts pass this Vite flag so the
> config is loaded directly instead of being pre-bundled by esbuild. It exists
> only because this project lives in a **subdirectory** of a repo whose root has
> an unrelated Expo `tsconfig.json`; the flag stops Vite from walking up into it.
> If you ever copy this project out to its own repo, the flag is harmless to keep
> or remove.

---

## Editing the plan

**All schedule data is in [`src/plan.ts`](src/plan.ts)** and is meant to be edited
by hand. It's heavily commented. The shape:

```ts
'2026-06-17': {
  theme: 'Kickoff — Physics base + Math refresh',
  blocks: [
    block(
      'PH',                       // subject code (keys of SUBJECTS)
      'Kinematics & forces',      // topic heading
      'Re-derive the suvat …',    // "what to do"
      'Goal: rebuild … <b>Do 8 problems</b>.', // debrief (exam tip; <b> allowed)
      [ vid('Physics Online — kinematics', 'Physics Online IB kinematics suvat') ],
      'Morning · 90m',            // time label
    ),
  ],
},
```

Common edits:

- **Add a day** → add a new `'YYYY-MM-DD': { … }` key.
- **Mark a day type** → set `rest: true`, `holiday: true`, or `visitor: true`.
- **Add a sport event** → set `sport: 'USA v Australia — 06:00 …'` (adds a ★ and a
  banner).
- **Add a subject** → add an entry to `SUBJECTS` (code, name, color) and, if it
  should appear in the legend/filter, to `STUDY_SUBJECTS`.
- **Pin a real video** instead of a search → replace `vid('Label', 'query')` with a
  literal `{ label: 'Label', url: 'https://youtu.be/…' }`.
- **Change the calendar window** → edit `PLAN_START_ISO` / `PLAN_END_ISO` at the
  bottom of the file (and the visible months in `src/lib/dates.ts` if you move
  outside Jun–Aug).

No other file needs to change for day-to-day schedule edits.

---

## Project structure

```
study-calendar/
├─ index.html
├─ src/
│  ├─ plan.ts              ← all schedule data + types (edit this)
│  ├─ App.tsx              ← top-level state (month, modal, completion, filter)
│  ├─ main.tsx
│  ├─ index.css            ← Tailwind v4 theme tokens + small base styles
│  ├─ lib/
│  │  ├─ dates.ts          ← date-fns helpers, month grid, week grouping
│  │  └─ storage.ts        ← localStorage for completion
│  └─ components/
│     ├─ Header.tsx
│     ├─ SubjectBar.tsx    ← legend + subject filter
│     ├─ WeekProgress.tsx  ← per-week progress bars
│     ├─ MonthNav.tsx
│     ├─ CalendarGrid.tsx
│     ├─ DayCell.tsx       ← one day (dots, star, tint, tagline)
│     └─ DayModal.tsx      ← the day study-guide modal
└─ vite.config.ts
```

---

## Deploying

The build is a fully static `dist/` — host it on anything. Because this project
lives in the **`study-calendar/` subdirectory** of the repo, point your host at
that subdirectory.

Asset URLs are relative (`base: './'` in `vite.config.ts`), so the same build works
at a domain root **or** under a sub-path like `username.github.io/LukiPuk1e/` with
no extra config.

### Vercel

1. Import the repo.
2. Set **Root Directory** to `study-calendar`.
3. Framework preset: **Vite** (Build `npm run build`, Output `dist`). Deploy.

### Netlify

- **Base directory:** `study-calendar`
- **Build command:** `npm run build`
- **Publish directory:** `study-calendar/dist`

(Or commit a `netlify.toml` with those values.)

### GitHub Pages

Pages can't build a subdirectory project on its own, so use a small Actions
workflow. Create `.github/workflows/deploy-study-calendar.yml` at the **repo root**:

```yaml
name: Deploy study-calendar to Pages
on:
  push:
    branches: [main]
    paths: ['study-calendar/**']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: study-calendar
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: study-calendar/package-lock.json
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: study-calendar/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then enable **Settings → Pages → Source: GitHub Actions**. Pushing changes under
`study-calendar/` to `main` will build and publish automatically.

> Prefer not to use Actions? Run `npm run build` locally and push the contents of
> `study-calendar/dist` to a `gh-pages` branch (e.g. with the `gh-pages` npm
> package or `git subtree`).

---

## Notes

- **Times** shown in sport notes are Taiwan time (UTC+8). The end date (Sat 15 Aug)
  is a placeholder — adjust in `plan.ts`.
- **Completion data** is per-browser (`localStorage`); it isn't synced anywhere.
  Clearing site data resets it. Bump the key version in `src/lib/storage.ts` to
  reset programmatically.
