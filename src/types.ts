export interface Position {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  buyPrice: number;
  buyDate: string; // ISO date
}

export interface Quote {
  price: number;
  change: number;
  changePct: number;
  prevClose: number;
  updatedAt: number;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  sector: string;
  marketCapM: number; // millions USD
  logo?: string;
  weburl?: string;
  exchange?: string;
}

export interface KeyMetrics {
  peTTM?: number;
  week52High?: number;
  week52Low?: number;
  grossMarginTTM?: number;
  revenueGrowthTTMYoy?: number;
  dividendYield?: number;
  beta?: number;
}

export interface Candle {
  date: string; // YYYY-MM-DD
  close: number;
}

export type CapTier = 'Mega-cap' | 'Large-cap' | 'Mid-cap' | 'Small-cap';

export type SourceType = 'analyst' | 'news' | 'filing';

export interface SignalSummary {
  analyst: {
    positive: boolean;
    buyRatio: number; // 0..1 share of buy+strongBuy in latest period
    delta: number; // change in buyRatio vs ~2 months earlier
    total: number; // analysts covering
  } | null;
  news: {
    positive: boolean;
    score: number; // -1..1 keyword sentiment
    articles: number;
    topHeadlines: { headline: string; source: string; url: string }[];
  } | null;
  filing: {
    positive: boolean; // recent material filing while other signals are positive
    recent8K: number;
  } | null;
}

export interface Thesis {
  hook: string; // one-line main selling point
  blurb: string; // what they do, one short paragraph
  bullCase: string[];
  bearCase: string[];
  generatedBy: 'llm' | 'template';
}

export interface DeckCard {
  symbol: string;
  profile: CompanyProfile;
  metrics: KeyMetrics;
  capTier: CapTier;
  price: number;
  changePct: number;
  longTermScore: number; // 0..100
  momentumScore: number; // 0..100
  signals: SignalSummary;
  sourceTypes: SourceType[]; // which source types fired positive
  whyTag: string; // "why you're seeing this"
  thesis: Thesis;
  builtAt: string; // ISO datetime
  demo?: boolean;
}

export type SwipeDirection = 'left' | 'right';

export interface SwipeRecord {
  symbol: string;
  direction: SwipeDirection;
  sector: string;
  capTier: CapTier;
  at: string; // ISO datetime
}

export interface CatalogEntry {
  card: DeckCard;
  addedAt: string;
}

export interface BuildProgress {
  phase: 'idle' | 'analysts' | 'news' | 'history' | 'thesis' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
}

export type NotificationSeverity = 'normal' | 'important' | 'urgent';
export type NotificationType = 'debrief' | 'market' | 'deck' | 'catalog';

export interface NotificationDraft {
  key: string; // dedupe key (usually includes the day) — one per key
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  symbols?: string[];
}

export interface NotificationItem extends NotificationDraft {
  id: string;
  createdAt: string;
  read: boolean;
  /** True once the OS actually displayed it (see store deliverPending). */
  delivered?: boolean;
}
