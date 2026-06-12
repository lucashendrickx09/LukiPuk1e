import { DeckCard, Position, Quote, SignalSummary } from '@/types';

// Demo mode content — shown until a Finnhub key is configured so every screen
// is explorable out of the box. All numbers are illustrative, not live data.

function demoSignals(buyRatio: number, newsScore: number, articles: number): SignalSummary {
  return {
    analyst: { positive: buyRatio >= 0.6, buyRatio, delta: 0.04, total: 30 },
    news: {
      positive: newsScore > 0.25,
      score: newsScore,
      articles,
      topHeadlines: [
        { headline: 'Demo headline — connect a Finnhub key for live news', source: 'Demo', url: 'https://finnhub.io' },
      ],
    },
    filing: { positive: true, recent8K: 1 },
  };
}

function demoCard(
  symbol: string,
  name: string,
  sector: string,
  capM: number,
  price: number,
  changePct: number,
  lt: number,
  mo: number,
  hook: string,
  blurb: string,
  bull: string[],
  bear: string[],
): DeckCard {
  return {
    symbol,
    profile: { symbol, name, sector, marketCapM: capM },
    metrics: { peTTM: 28, week52High: price * 1.15, week52Low: price * 0.7, grossMarginTTM: 45, revenueGrowthTTMYoy: 14 },
    capTier: capM >= 200_000 ? 'Mega-cap' : capM >= 10_000 ? 'Large-cap' : 'Mid-cap',
    price,
    changePct,
    longTermScore: lt,
    momentumScore: mo,
    signals: demoSignals(0.68, 0.5, 14),
    sourceTypes: ['analyst', 'news'],
    whyTag: 'Demo data · 68% analyst buy lean + bullish coverage',
    thesis: { hook, blurb, bullCase: bull, bearCase: bear, generatedBy: 'template' },
    builtAt: new Date().toISOString(),
    demo: true,
  };
}

export const DEMO_DECK: DeckCard[] = [
  demoCard(
    'NVDA', 'NVIDIA', 'Semiconductors', 3_400_000, 182.4, 1.8, 78, 84,
    'The picks-and-shovels of the AI buildout, still compounding.',
    'NVIDIA designs the GPUs and networking that power AI datacenters. Demo card — connect your API keys in Settings to get live, analyzed candidates.',
    ['Demo: datacenter revenue growing double digits', 'Demo: broad analyst buy consensus', 'Demo: new product cycle underway'],
    ['Demo: valuation assumes years of flawless execution', 'Demo: customer concentration in a few hyperscalers'],
  ),
  demoCard(
    'COST', 'Costco', 'Consumer Defensive', 440_000, 985.1, 0.4, 81, 62,
    'A membership machine that compounds through any economy.',
    'Costco runs membership warehouses with famously loyal customers and steady fee income. Demo card — live analysis activates with a Finnhub key.',
    ['Demo: membership renewal rates above 90%', 'Demo: defensive earnings in downturns', 'Demo: steady store expansion'],
    ['Demo: rarely cheap — premium valuation persists', 'Demo: thin retail margins by design'],
  ),
  demoCard(
    'LLY', 'Eli Lilly', 'Healthcare', 720_000, 762.3, 2.2, 75, 79,
    'Riding the biggest drug launch wave in a generation.',
    'Eli Lilly develops blockbuster treatments in metabolic health and oncology. Demo card — live analysis activates with a Finnhub key.',
    ['Demo: category-defining drug franchise', 'Demo: pipeline depth beyond the flagship', 'Demo: pricing power in key markets'],
    ['Demo: high expectations already in the price', 'Demo: competition scaling fast'],
  ),
  demoCard(
    'GE', 'GE Aerospace', 'Industrials', 190_000, 246.7, 1.1, 72, 76,
    'A focused aerospace pure-play with a service-revenue moat.',
    'GE Aerospace builds and services jet engines, earning recurring revenue per flight hour. Demo card — live analysis activates with a Finnhub key.',
    ['Demo: multi-decade service contracts', 'Demo: air travel demand recovering globally', 'Demo: upgraded guidance'],
    ['Demo: cyclical exposure to airline capex', 'Demo: supply chain constraints linger'],
  ),
  demoCard(
    'SMH', 'Semiconductor ETF', 'ETF', 25_000, 268.9, 1.5, 70, 80,
    'One ticker for the whole chip supply chain.',
    'SMH holds the leading semiconductor designers, fabs and equipment makers in a single fund. Demo card — live analysis activates with a Finnhub key.',
    ['Demo: diversified AI exposure without single-stock risk', 'Demo: sector momentum strongly positive'],
    ['Demo: high concentration in top holdings', 'Demo: chip cycles cut both ways'],
  ),
  demoCard(
    'ABNB', 'Airbnb', 'Consumer Cyclical', 85_000, 138.5, -0.6, 64, 68,
    'An asset-light travel platform expanding into new lines.',
    'Airbnb runs the leading marketplace for stays and experiences, with strong free cash flow. Demo card — live analysis activates with a Finnhub key.',
    ['Demo: capital-light model with high margins', 'Demo: expansion beyond core stays', 'Demo: buybacks shrinking share count'],
    ['Demo: travel demand is cyclical', 'Demo: regulatory pressure in key cities'],
  ),
];

export const DEMO_QUOTES: Record<string, Quote> = {
  AAPL: { price: 243.2, change: 1.3, changePct: 0.54, prevClose: 241.9, updatedAt: 0 },
  MSFT: { price: 512.8, change: -2.1, changePct: -0.41, prevClose: 514.9, updatedAt: 0 },
  NVDA: { price: 182.4, change: 3.2, changePct: 1.79, prevClose: 179.2, updatedAt: 0 },
  VTI: { price: 312.5, change: 0.9, changePct: 0.29, prevClose: 311.6, updatedAt: 0 },
  SCHD: { price: 29.4, change: 0.1, changePct: 0.34, prevClose: 29.3, updatedAt: 0 },
  COST: { price: 985.1, change: 3.9, changePct: 0.4, prevClose: 981.2, updatedAt: 0 },
  LLY: { price: 762.3, change: 16.4, changePct: 2.2, prevClose: 745.9, updatedAt: 0 },
  GE: { price: 246.7, change: 2.7, changePct: 1.1, prevClose: 244.0, updatedAt: 0 },
  SMH: { price: 268.9, change: 4.0, changePct: 1.5, prevClose: 264.9, updatedAt: 0 },
  ABNB: { price: 138.5, change: -0.8, changePct: -0.6, prevClose: 139.3, updatedAt: 0 },
};

export const DEMO_POSITIONS: Omit<Position, 'id'>[] = [
  { symbol: 'AAPL', name: 'Apple', shares: 10, buyPrice: 196.5, buyDate: '2025-09-15' },
  { symbol: 'MSFT', name: 'Microsoft', shares: 4, buyPrice: 468.0, buyDate: '2025-11-02' },
  { symbol: 'NVDA', name: 'NVIDIA', shares: 12, buyPrice: 151.2, buyDate: '2025-08-20' },
  { symbol: 'VTI', name: 'Total US Market ETF', shares: 15, buyPrice: 289.4, buyDate: '2025-06-10' },
  { symbol: 'SCHD', name: 'US Dividend ETF', shares: 60, buyPrice: 27.1, buyDate: '2025-05-05' },
];
