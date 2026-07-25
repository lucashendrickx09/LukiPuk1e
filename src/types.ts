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

// ---- Deep research ------------------------------------------------------
// The research engine reads a company across four evidence pillars (company
// filings, sell-side/bank research, institutional & insider positioning, and
// congressional disclosures) and returns a sourced verdict. Everything the
// model asserts is split into three buckets on purpose: DATA (a figure from a
// document), SOURCES (where it came from) and SPECULATION (forward-looking
// judgement that no document supports yet).

export type ResearchPillar =
  | 'financials'
  | 'wallStreet'
  | 'institutions'
  | 'politicians';

export type SourceKind =
  | 'filing' // 10-K, 10-Q, 8-K, S-1
  | 'transcript' // earnings call / investor day
  | 'investorLetter' // fund letters, shareholder letters
  | 'analyst' // bank or research-firm note, price target
  | 'institutional' // 13F/13D/G, Form 4 insider trades
  | 'political' // STOCK Act periodic transaction reports
  | 'news'
  | 'other';

export interface ResearchSource {
  title: string;
  url: string;
  publisher?: string;
  /** YYYY-MM-DD when the model could establish it. */
  date?: string;
  kind: SourceKind;
}

export type Stance = 'bullish' | 'bearish' | 'neutral';

export interface EvidenceItem {
  /** The finding, stated plainly. */
  claim: string;
  /** The underlying figures/quotes — the "data" half of data vs speculation. */
  detail: string;
  stance: Stance;
  /** Index into DeepResearchReport.sources, when attributable. */
  sourceIndex?: number;
}

export interface EvidenceBlock {
  summary: string;
  items: EvidenceItem[];
  /** 0-100: how well-evidenced this pillar is (low = little was findable). */
  strength: number;
}

export type ResearchVerdict = 'buy' | 'accumulate' | 'hold' | 'trim' | 'exit' | 'avoid';

export interface DeepResearchReport {
  symbol: string;
  name: string;
  /** True when the report was produced for a position you already hold. */
  owned: boolean;
  generatedAt: string;
  model: string;

  // Long-form identity — this is what elongates the company description.
  profileLong: string;
  businessModel: string;
  moat: string;
  futureRole: string;
  relevanceDrivers: string[];
  relevanceRisks: string[];

  financials: EvidenceBlock;
  wallStreet: EvidenceBlock;
  institutions: EvidenceBlock;
  politicians: EvidenceBlock;

  verdict: ResearchVerdict;
  /** 0-100 confidence in the verdict. */
  confidence: number;
  reasoning: string;
  /** Hard numbers the verdict leans on. */
  keyData: { label: string; value: string; note?: string }[];
  /** Explicitly forward-looking, unproven judgement. */
  speculation: string;
  /** What would falsify the verdict. */
  disconfirming: string[];
  /** Suggested share of the portfolio, 0-100. */
  targetWeightPct?: number;
  sources: ResearchSource[];
}

export type ActionKind = 'sell' | 'trim' | 'buy' | 'add' | 'hold' | 'watch';

export interface RebalanceAction {
  id: string;
  kind: ActionKind;
  /** One-line instruction, e.g. "Trim 12 NKE ($1,140) → add 3 ASML ($1,116)". */
  headline: string;
  sellSymbol?: string;
  sellShares?: number;
  sellValueUsd?: number;
  buySymbol?: string;
  buyShares?: number;
  buyValueUsd?: number;
  reasoning: string;
  /** 0-100. */
  confidence: number;
  risks: string;
  /** URLs backing the action (subset of the reports' sources). */
  sourceUrls: string[];
}

export interface ResearchProgress {
  phase: 'idle' | 'planning' | 'company' | 'synthesis' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
}

export interface ResearchRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  model: string;
  /** Symbols requested for this run. */
  symbols: string[];
  /** Narrative view of the whole portfolio. */
  portfolioView: string;
  actions: RebalanceAction[];
  /** Which sources were consulted and what the known blind spots are. */
  method: string;
  failures: { symbol: string; reason: string }[];
}
