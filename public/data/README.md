# Screener cache

Written by `.github/workflows/screener-nightly.yml`, read by the app. Nothing
here is hand-edited.

- `index.json` — every company in the universe with its raw metrics, sector and
  profile, plus a 90-point sparkline. Budgeted under 1.5 MB.
- `charts/{TICKER}.json` — about 19 months of daily closes as `[date, close]`
  pairs. Written by `.github/workflows/charts-nightly.yml`.
- `charts.json` — which tickers that job published, and when.

The charts exist because the web build cannot fetch price history itself.
Neither Stooq nor Yahoo sends CORS headers, so a browser `fetch` to either is
blocked before it is sent, and every chart in the PWA came back empty. The
app's own origin is the one host it can always reach, so the history is fetched
on a runner and served from here. Native builds read the live source directly
and only fall back to these files.

The app computes percentiles, bucket scores and the composite itself, because
the composite depends on the user's factor weights and concentration lambda and
has to change the moment those sliders move. Percentiles are sector-relative, so
they need the whole universe — which is why the universe ships as one file.
