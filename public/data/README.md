# Screener cache

Written by `.github/workflows/screener-nightly.yml`, read by the app. Nothing
here is hand-edited.

- `index.json` — every company in the universe with its raw metrics, sector and
  profile, plus a 90-point sparkline. Budgeted under 1.5 MB.
- `charts/{TICKER}.json` — price history, weekly beyond a year and daily inside
  it, for the detail view.

The app computes percentiles, bucket scores and the composite itself, because
the composite depends on the user's factor weights and concentration lambda and
has to change the moment those sliders move. Percentiles are sector-relative, so
they need the whole universe — which is why the universe ships as one file.
