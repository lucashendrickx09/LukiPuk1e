// Extra symbols to publish price history for.
//
// The nightly chart job already covers the screener universe and the deck's
// candidate universe. Add a ticker here if you hold or watch something outside
// both and want its chart to work in the web app. The job also keeps
// refreshing anything that already has a file, and takes one-off tickers via
// the workflow's `symbols` input.

export const EXTRA_SYMBOLS: string[] = [
  // Benchmarks and broad ETFs the analytics screen and portfolios lean on.
  'SPY',
  'VOO',
  'VXUS',
  'ARKK',
  'IWM',
  'DIA',
  'BRK-B',
];
