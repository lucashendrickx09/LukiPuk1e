// v0.1 candidate universe: ~60 liquid US large/mega caps across sectors plus a
// handful of broad ETFs. Kept small deliberately — every deck build spends one
// Finnhub call per symbol in stage 1, and the free tier allows 60 calls/min.
// v0.2 replaces this with a screener/trending-driven universe.

export interface UniverseEntry {
  symbol: string;
  fallbackName: string;
  fallbackSector: string;
  etf?: boolean;
}

export const UNIVERSE: UniverseEntry[] = [
  { symbol: 'AAPL', fallbackName: 'Apple', fallbackSector: 'Technology' },
  { symbol: 'MSFT', fallbackName: 'Microsoft', fallbackSector: 'Technology' },
  { symbol: 'NVDA', fallbackName: 'NVIDIA', fallbackSector: 'Semiconductors' },
  { symbol: 'GOOGL', fallbackName: 'Alphabet', fallbackSector: 'Communication Services' },
  { symbol: 'AMZN', fallbackName: 'Amazon', fallbackSector: 'Consumer Cyclical' },
  { symbol: 'META', fallbackName: 'Meta Platforms', fallbackSector: 'Communication Services' },
  { symbol: 'TSLA', fallbackName: 'Tesla', fallbackSector: 'Automotive' },
  { symbol: 'AVGO', fallbackName: 'Broadcom', fallbackSector: 'Semiconductors' },
  { symbol: 'AMD', fallbackName: 'AMD', fallbackSector: 'Semiconductors' },
  { symbol: 'CRM', fallbackName: 'Salesforce', fallbackSector: 'Technology' },
  { symbol: 'ORCL', fallbackName: 'Oracle', fallbackSector: 'Technology' },
  { symbol: 'ADBE', fallbackName: 'Adobe', fallbackSector: 'Technology' },
  { symbol: 'NOW', fallbackName: 'ServiceNow', fallbackSector: 'Technology' },
  { symbol: 'INTU', fallbackName: 'Intuit', fallbackSector: 'Technology' },
  { symbol: 'PLTR', fallbackName: 'Palantir', fallbackSector: 'Technology' },
  { symbol: 'SNOW', fallbackName: 'Snowflake', fallbackSector: 'Technology' },
  { symbol: 'UBER', fallbackName: 'Uber', fallbackSector: 'Technology' },
  { symbol: 'SHOP', fallbackName: 'Shopify', fallbackSector: 'Technology' },
  { symbol: 'NFLX', fallbackName: 'Netflix', fallbackSector: 'Communication Services' },
  { symbol: 'DIS', fallbackName: 'Disney', fallbackSector: 'Communication Services' },
  { symbol: 'JPM', fallbackName: 'JPMorgan Chase', fallbackSector: 'Financial Services' },
  { symbol: 'BAC', fallbackName: 'Bank of America', fallbackSector: 'Financial Services' },
  { symbol: 'GS', fallbackName: 'Goldman Sachs', fallbackSector: 'Financial Services' },
  { symbol: 'V', fallbackName: 'Visa', fallbackSector: 'Financial Services' },
  { symbol: 'MA', fallbackName: 'Mastercard', fallbackSector: 'Financial Services' },
  { symbol: 'AXP', fallbackName: 'American Express', fallbackSector: 'Financial Services' },
  { symbol: 'BRK.B', fallbackName: 'Berkshire Hathaway', fallbackSector: 'Financial Services' },
  { symbol: 'UNH', fallbackName: 'UnitedHealth', fallbackSector: 'Healthcare' },
  { symbol: 'LLY', fallbackName: 'Eli Lilly', fallbackSector: 'Healthcare' },
  { symbol: 'JNJ', fallbackName: 'Johnson & Johnson', fallbackSector: 'Healthcare' },
  { symbol: 'ABBV', fallbackName: 'AbbVie', fallbackSector: 'Healthcare' },
  { symbol: 'MRK', fallbackName: 'Merck', fallbackSector: 'Healthcare' },
  { symbol: 'PFE', fallbackName: 'Pfizer', fallbackSector: 'Healthcare' },
  { symbol: 'TMO', fallbackName: 'Thermo Fisher', fallbackSector: 'Healthcare' },
  { symbol: 'XOM', fallbackName: 'Exxon Mobil', fallbackSector: 'Energy' },
  { symbol: 'CVX', fallbackName: 'Chevron', fallbackSector: 'Energy' },
  { symbol: 'NEE', fallbackName: 'NextEra Energy', fallbackSector: 'Utilities' },
  { symbol: 'WMT', fallbackName: 'Walmart', fallbackSector: 'Consumer Defensive' },
  { symbol: 'COST', fallbackName: 'Costco', fallbackSector: 'Consumer Defensive' },
  { symbol: 'PG', fallbackName: 'Procter & Gamble', fallbackSector: 'Consumer Defensive' },
  { symbol: 'KO', fallbackName: 'Coca-Cola', fallbackSector: 'Consumer Defensive' },
  { symbol: 'PEP', fallbackName: 'PepsiCo', fallbackSector: 'Consumer Defensive' },
  { symbol: 'MCD', fallbackName: "McDonald's", fallbackSector: 'Consumer Cyclical' },
  { symbol: 'NKE', fallbackName: 'Nike', fallbackSector: 'Consumer Cyclical' },
  { symbol: 'SBUX', fallbackName: 'Starbucks', fallbackSector: 'Consumer Cyclical' },
  { symbol: 'HD', fallbackName: 'Home Depot', fallbackSector: 'Consumer Cyclical' },
  { symbol: 'ABNB', fallbackName: 'Airbnb', fallbackSector: 'Consumer Cyclical' },
  { symbol: 'BA', fallbackName: 'Boeing', fallbackSector: 'Industrials' },
  { symbol: 'CAT', fallbackName: 'Caterpillar', fallbackSector: 'Industrials' },
  { symbol: 'GE', fallbackName: 'GE Aerospace', fallbackSector: 'Industrials' },
  { symbol: 'RTX', fallbackName: 'RTX', fallbackSector: 'Industrials' },
  { symbol: 'UPS', fallbackName: 'UPS', fallbackSector: 'Industrials' },
  { symbol: 'INTC', fallbackName: 'Intel', fallbackSector: 'Semiconductors' },
  { symbol: 'MU', fallbackName: 'Micron', fallbackSector: 'Semiconductors' },
  { symbol: 'QCOM', fallbackName: 'Qualcomm', fallbackSector: 'Semiconductors' },
  { symbol: 'TXN', fallbackName: 'Texas Instruments', fallbackSector: 'Semiconductors' },
  // ETFs — analyst recommendation data is sparse for funds, so these mostly
  // surface via news + momentum; they are also valid portfolio holdings.
  { symbol: 'SPY', fallbackName: 'S&P 500 ETF', fallbackSector: 'ETF', etf: true },
  { symbol: 'QQQ', fallbackName: 'Nasdaq 100 ETF', fallbackSector: 'ETF', etf: true },
  { symbol: 'VTI', fallbackName: 'Total US Market ETF', fallbackSector: 'ETF', etf: true },
  { symbol: 'SMH', fallbackName: 'Semiconductor ETF', fallbackSector: 'ETF', etf: true },
  { symbol: 'XLE', fallbackName: 'Energy Sector ETF', fallbackSector: 'ETF', etf: true },
  { symbol: 'SCHD', fallbackName: 'US Dividend ETF', fallbackSector: 'ETF', etf: true },
];

export const UNIVERSE_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u]));
