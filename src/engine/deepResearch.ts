import { groundedJson } from '@/api/anthropic';
import {
  DeepResearchReport,
  EvidenceBlock,
  EvidenceItem,
  RebalanceAction,
  ResearchSource,
  ResearchVerdict,
  SourceKind,
  Stance,
} from '@/types';

// Deep research engine.
//
// Two kinds of call:
//   1. researchCompany() — one grounded Claude call per company, which searches
//      four evidence pillars (company filings & statements, sell-side/bank
//      research, institutional + insider positioning, congressional trading
//      disclosures) and returns a sourced brief with a verdict and confidence.
//   2. synthesizeRebalance() — one reasoning call over all the briefs plus the
//      live portfolio, which turns them into sized, funded actions.
//
// The model is never trusted for arithmetic: every share count and dollar
// amount an action carries is recomputed here from live prices and the actual
// position sizes before it reaches the UI.

// ---- Schemas --------------------------------------------------------------
// Optional values are expressed as sentinels ('' / -1) rather than nullable
// types so the schema stays inside the strict structured-output subset.

const EVIDENCE_BLOCK_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'What this pillar says about the company, in 2-4 sentences. If you found little, say so plainly.',
    },
    items: {
      type: 'array',
      description: '2-6 specific findings. Each must come from something you actually opened.',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The finding in one sentence.' },
          detail: {
            type: 'string',
            description:
              'The hard data behind it: figures, dates, filing/report names, who said it. No speculation here.',
          },
          stance: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
          sourceIndex: {
            type: 'integer',
            description: '0-based index into the sources array. Use -1 only if truly unattributable.',
          },
        },
        required: ['claim', 'detail', 'stance', 'sourceIndex'],
        additionalProperties: false,
      },
    },
    strength: {
      type: 'integer',
      description:
        '0-100: how well-evidenced this pillar is. Low means you could not find much, not that the news was bad.',
    },
  },
  required: ['summary', 'items', 'strength'],
  additionalProperties: false,
} as const;

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    profileLong: {
      type: 'string',
      description:
        'Three substantial paragraphs on who this company actually is: history and what changed it, what it sells and to whom, how the money is really made, scale, geography, and where it sits in its industry value chain. Written for an intelligent non-specialist.',
    },
    businessModel: {
      type: 'string',
      description:
        'How revenue is generated and converted to profit: segments and their share of revenue, pricing model, unit economics, customer concentration, cyclicality.',
    },
    moat: {
      type: 'string',
      description: 'The durable competitive advantage, if any — and how solid it actually is.',
    },
    futureRole: {
      type: 'string',
      description:
        'Two paragraphs on the role this company plausibly plays 3-10 years out: which structural shifts it sits on, what it would have to win, and what the world looks like if it does.',
    },
    relevanceDrivers: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 concrete things keeping this company relevant.',
    },
    relevanceRisks: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 concrete things that could make it irrelevant or structurally impaired.',
    },
    financials: EVIDENCE_BLOCK_SCHEMA,
    wallStreet: EVIDENCE_BLOCK_SCHEMA,
    institutions: EVIDENCE_BLOCK_SCHEMA,
    politicians: EVIDENCE_BLOCK_SCHEMA,
    verdict: {
      type: 'string',
      enum: ['buy', 'accumulate', 'hold', 'trim', 'exit', 'avoid'],
      description:
        'For an owned position use hold/trim/exit/accumulate. For one not owned use buy/accumulate/avoid.',
    },
    confidence: {
      type: 'integer',
      description:
        '0-100 confidence in the verdict. Be honest: thin evidence or conflicting signals means a low number.',
    },
    reasoning: {
      type: 'string',
      description:
        'Two to four paragraphs walking through how the evidence produced this verdict, naming which pillars carried the most weight and where they disagreed.',
    },
    keyData: {
      type: 'array',
      description: '5-10 hard figures the verdict leans on, each with an as-of date in the note.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          note: { type: 'string', description: 'As-of date and source. Empty string if unknown.' },
        },
        required: ['label', 'value', 'note'],
        additionalProperties: false,
      },
    },
    speculation: {
      type: 'string',
      description:
        'Everything forward-looking or inferred, quarantined here and clearly framed as your own judgement rather than fact.',
    },
    disconfirming: {
      type: 'array',
      items: { type: 'string' },
      description: '2-4 specific, checkable things that would prove this verdict wrong.',
    },
    targetWeightPct: {
      type: 'number',
      description: 'Sensible share of the whole portfolio for this name, 0-100. 0 means avoid.',
    },
    sources: {
      type: 'array',
      description:
        '4-12 sources you actually opened. Real URLs only — never invent one or reuse a URL you did not visit.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          publisher: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD, or empty string if unknown.' },
          kind: {
            type: 'string',
            enum: [
              'filing',
              'transcript',
              'investorLetter',
              'analyst',
              'institutional',
              'political',
              'news',
              'other',
            ],
          },
        },
        required: ['title', 'url', 'publisher', 'date', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'profileLong',
    'businessModel',
    'moat',
    'futureRole',
    'relevanceDrivers',
    'relevanceRisks',
    'financials',
    'wallStreet',
    'institutions',
    'politicians',
    'verdict',
    'confidence',
    'reasoning',
    'keyData',
    'speculation',
    'disconfirming',
    'targetWeightPct',
    'sources',
  ],
  additionalProperties: false,
} as const;

const RESEARCH_SYSTEM = `You are a buy-side equity analyst writing a decision-grade brief on ONE company for a single private investor's own portfolio.

You MUST use the web_search tool before writing anything. Never answer from memory — prices, ratings, filings and disclosures all move. Work all four pillars:

1. COMPANY FILINGS AND STATEMENTS — the latest annual report (10-K / 20-F) and quarterly (10-Q) on SEC EDGAR (sec.gov), the most recent earnings release and what management said on the call, plus any shareholder or investor letters. Extract real figures: revenue and growth, gross and operating margin, free cash flow, net cash or debt, buybacks and dividends, segment mix, and guidance.

2. WALL STREET, BANKS AND RESEARCH FIRMS — recent ratings actions, price-target changes and the arguments behind them from major banks and research houses (Goldman Sachs, Morgan Stanley, JPMorgan, Bank of America, UBS, Barclays, Citi, Jefferies, Bernstein, Evercore, Wedbush, Baird, Morningstar and similar). Report the reasoning, not just the number, and note where the sell side disagrees with itself.

3. INSTITUTIONAL AND INSIDER POSITIONING — quarterly 13F changes by well-regarded managers, 13D/13G stakes, and Form 4 insider buying and selling. Use SEC EDGAR plus aggregators such as WhaleWisdom, Dataroma, Fintel, HedgeFollow, GuruFocus and Insider Monkey. 13F data is a quarter-end snapshot filed up to 45 days later — say so when you use it.

4. CONGRESSIONAL AND POLITICAL DISCLOSURES — STOCK Act periodic transaction reports from the House Clerk (disclosures-clerk.house.gov) and Senate eFD (efdsearch.senate.gov), and aggregators such as Capitol Trades, Quiver Quantitative and Unusual Whales. These filings are lagged by up to 45 days and report dollar RANGES, not exact amounts; a member may not have chosen the trade themselves. State those limits every time you use them and never present them as more than weak, delayed, public signal. Also cover legislation, contracts, tariffs, subsidies, export controls or regulation that plausibly moves this company.

HARD RULES
- Every factual claim traces to a page you actually opened. The figure goes in "detail"; point sourceIndex at the source used.
- If a pillar turns up nothing credible, say exactly that and give it a low "strength". Never manufacture evidence, guess a number, or cite a URL you did not visit.
- Keep data and speculation strictly apart. Evidence "detail" fields carry only what a document says. Anything inferred, forward-looking, or your own judgement belongs in "speculation".
- Date everything. "As of" matters more than the number.
- Be willing to reach an unwelcome conclusion. A held position that no longer deserves the capital should be marked trim or exit, and a popular name with thin evidence should get a low confidence.
- This is educational research for one individual's own decisions, not investment advice or a solicitation, and every disclosure you use is public information.`;

export interface CompanyResearchInput {
  symbol: string;
  name: string;
  sector?: string;
  owned: boolean;
  shares?: number;
  avgCost?: number;
  price?: number;
  positionValueUsd?: number;
  portfolioWeightPct?: number;
  plPct?: number;
  firstBuyDate?: string;
  /** Short thesis already on file, so the brief can agree or push back on it. */
  existingThesis?: string;
}

export interface PortfolioContext {
  asOf: string;
  totalValueUsd: number;
  cashUsd: number;
  holdings: {
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    price: number;
    valueUsd: number;
    weightPct: number;
    plPct: number;
    sector: string;
  }[];
  sectorWeights: { sector: string; pct: number }[];
  /**
   * Last known price for every symbol in scope, including candidates that
   * aren't held. Share counts are always derived from these, never from the
   * model's own arithmetic.
   */
  prices: Record<string, number>;
}

export type ResearchDepth = 'standard' | 'deep';

const DEPTH: Record<ResearchDepth, { searches: number; maxTokens: number }> = {
  standard: { searches: 8, maxTokens: 6000 },
  deep: { searches: 16, maxTokens: 8000 },
};

/** Searches per company, exposed so the UI can show what a run will cost. */
export function searchesPerCompany(depth: ResearchDepth): number {
  return DEPTH[depth].searches;
}

export async function researchCompany(args: {
  apiKey: string;
  model: string;
  input: CompanyResearchInput;
  portfolio: PortfolioContext;
  depth: ResearchDepth;
  signal?: AbortSignal;
}): Promise<DeepResearchReport> {
  const { input, portfolio } = args;
  const cfg = DEPTH[args.depth];

  const position = input.owned
    ? `The investor ALREADY OWNS this. Position: ${input.shares} shares at an average cost of $${(
        input.avgCost ?? 0
      ).toFixed(2)}, currently $${(input.price ?? 0).toFixed(2)} — worth about $${Math.round(
        input.positionValueUsd ?? 0,
      ).toLocaleString('en-US')}, which is ${(input.portfolioWeightPct ?? 0).toFixed(
        1,
      )}% of the portfolio, ${(input.plPct ?? 0) >= 0 ? 'up' : 'down'} ${Math.abs(
        input.plPct ?? 0,
      ).toFixed(1)}% since ${input.firstBuyDate ?? 'purchase'}. Decide whether this capital still belongs here or would work harder somewhere else.`
    : `The investor does NOT own this — it is a shortlisted candidate. Decide whether it deserves a place in the portfolio, and at what weight, given what they already hold.`;

  const book = portfolio.holdings.length
    ? portfolio.holdings
        .map(
          (h) =>
            `  ${h.symbol} (${h.sector}) — ${h.shares} sh, $${Math.round(h.valueUsd).toLocaleString(
              'en-US',
            )}, ${h.weightPct.toFixed(1)}% of book, ${h.plPct >= 0 ? '+' : ''}${h.plPct.toFixed(1)}%`,
        )
        .join('\n')
    : '  (empty portfolio)';

  const user = `Research ${input.name} (${input.symbol})${
    input.sector ? `, ${input.sector}` : ''
  }. Today is ${portfolio.asOf}.

${position}

For context, the whole portfolio right now (total $${Math.round(
    portfolio.totalValueUsd,
  ).toLocaleString('en-US')}, cash $${Math.round(portfolio.cashUsd).toLocaleString('en-US')}):
${book}
Sector weights: ${
    portfolio.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(', ') || 'n/a'
  }
${input.existingThesis ? `\nThe thesis already on file: "${input.existingThesis}" — agree with it or push back on it explicitly.\n` : ''}
Search all four pillars, then write the brief. Judge this company on its own merits AND on what it adds to — or duplicates in — that book.`;

  const raw = await groundedJson<Record<string, unknown>>({
    apiKey: args.apiKey,
    model: args.model,
    system: RESEARCH_SYSTEM,
    user,
    schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: cfg.maxTokens,
    maxSearches: cfg.searches,
    signal: args.signal,
  });

  return normalizeReport(raw, input, args.model);
}

// ---- Normalising ----------------------------------------------------------

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

const VERDICTS: ResearchVerdict[] = ['buy', 'accumulate', 'hold', 'trim', 'exit', 'avoid'];
const KINDS: SourceKind[] = [
  'filing',
  'transcript',
  'investorLetter',
  'analyst',
  'institutional',
  'political',
  'news',
  'other',
];

function normalizeSources(v: unknown): ResearchSource[] {
  if (!Array.isArray(v)) return [];
  const out: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = raw as Record<string, unknown>;
    const url = str(s?.url);
    // Drop anything that isn't a real link — a fabricated citation is worse
    // than a missing one.
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const kind = str(s?.kind) as SourceKind;
    out.push({
      title: str(s?.title) || url,
      url,
      publisher: str(s?.publisher) || undefined,
      date: /^\d{4}-\d{2}-\d{2}$/.test(str(s?.date)) ? str(s?.date) : undefined,
      kind: KINDS.includes(kind) ? kind : 'other',
    });
  }
  return out;
}

function normalizeBlock(v: unknown, sourceCount: number): EvidenceBlock {
  const b = (v ?? {}) as Record<string, unknown>;
  const items: EvidenceItem[] = Array.isArray(b.items)
    ? b.items
        .map((raw) => {
          const it = raw as Record<string, unknown>;
          const stance = str(it?.stance) as Stance;
          const idx = num(it?.sourceIndex, -1);
          return {
            claim: str(it?.claim),
            detail: str(it?.detail),
            stance: (['bullish', 'bearish', 'neutral'] as Stance[]).includes(stance)
              ? stance
              : 'neutral',
            // Only keep an index that actually points at a source we kept.
            sourceIndex: Number.isInteger(idx) && idx >= 0 && idx < sourceCount ? idx : undefined,
          };
        })
        .filter((it) => it.claim !== '')
    : [];
  return {
    summary: str(b.summary, 'Nothing conclusive found for this pillar.'),
    items,
    strength: clamp(Math.round(num(b.strength, items.length ? 40 : 0)), 0, 100),
  };
}

function normalizeReport(
  raw: Record<string, unknown>,
  input: CompanyResearchInput,
  model: string,
): DeepResearchReport {
  const sources = normalizeSources(raw.sources);
  const n = sources.length;
  const verdict = str(raw.verdict) as ResearchVerdict;
  const keyData = Array.isArray(raw.keyData)
    ? raw.keyData
        .map((r) => {
          const d = r as Record<string, unknown>;
          return { label: str(d?.label), value: str(d?.value), note: str(d?.note) || undefined };
        })
        .filter((d) => d.label !== '' && d.value !== '')
    : [];

  return {
    symbol: input.symbol,
    name: input.name,
    owned: input.owned,
    generatedAt: new Date().toISOString(),
    model,
    profileLong: str(raw.profileLong),
    businessModel: str(raw.businessModel),
    moat: str(raw.moat),
    futureRole: str(raw.futureRole),
    relevanceDrivers: strList(raw.relevanceDrivers),
    relevanceRisks: strList(raw.relevanceRisks),
    financials: normalizeBlock(raw.financials, n),
    wallStreet: normalizeBlock(raw.wallStreet, n),
    institutions: normalizeBlock(raw.institutions, n),
    politicians: normalizeBlock(raw.politicians, n),
    verdict: VERDICTS.includes(verdict) ? verdict : 'hold',
    confidence: clamp(Math.round(num(raw.confidence, 50)), 0, 100),
    reasoning: str(raw.reasoning),
    keyData,
    speculation: str(raw.speculation),
    disconfirming: strList(raw.disconfirming),
    targetWeightPct: clamp(num(raw.targetWeightPct, 0), 0, 100),
    sources,
  };
}

// ---- Rebalance synthesis --------------------------------------------------

const ACTIONS_SCHEMA = {
  type: 'object',
  properties: {
    portfolioView: {
      type: 'string',
      description:
        'Three to five paragraphs on the portfolio as a whole: what it is actually a bet on, where it is concentrated or duplicated, which holdings are carrying it, which are dead weight, and what the research changed about that picture.',
    },
    method: {
      type: 'string',
      description:
        'What evidence this rests on and where the blind spots are — stale data, pillars that turned up nothing, disclosure lags, anything you could not verify.',
    },
    actions: {
      type: 'array',
      description:
        '0-6 actions, strongest conviction first. Returning none is a valid answer if the portfolio should be left alone.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['sell', 'trim', 'buy', 'add', 'hold', 'watch'] },
          headline: { type: 'string', description: 'One line, e.g. "Trim NKE to fund ASML".' },
          sellSymbol: { type: 'string', description: 'Ticker to sell/trim, or empty string.' },
          sellShares: {
            type: 'number',
            description: 'Shares to sell. Never more than is held. 0 if not selling.',
          },
          sellValueUsd: { type: 'number', description: 'Dollar proceeds, or 0.' },
          buySymbol: { type: 'string', description: 'Ticker to buy/add, or empty string.' },
          buyShares: { type: 'number', description: 'Shares to buy, or 0.' },
          buyValueUsd: { type: 'number', description: 'Dollars to deploy, or 0.' },
          reasoning: {
            type: 'string',
            description:
              'A full paragraph: what in the research drove this, which pillar carried it, and why the size is right.',
          },
          confidence: { type: 'integer', description: '0-100.' },
          risks: { type: 'string', description: 'What makes this the wrong move.' },
          sourceUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'URLs from the briefs that back this action.',
          },
        },
        required: [
          'kind',
          'headline',
          'sellSymbol',
          'sellShares',
          'sellValueUsd',
          'buySymbol',
          'buyShares',
          'buyValueUsd',
          'reasoning',
          'confidence',
          'risks',
          'sourceUrls',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['portfolioView', 'method', 'actions'],
  additionalProperties: false,
} as const;

const SYNTHESIS_SYSTEM = `You are a portfolio strategist. You are handed a set of already-researched company briefs — each with a verdict, a confidence score and its sources — plus the investor's live holdings with share counts, prices and weights, and their available cash. Turn that into concrete, executable moves.

RULES
- Size every action in real share counts and dollars computed from the prices you are given. Never propose selling more shares than are actually held.
- Fund every buy. Either it comes out of stated cash, or the same action names the specific position being sold or trimmed to pay for it.
- Prefer a few high-conviction moves to many marginal ones. "Leave it alone" is a legitimate and often correct answer.
- Weigh the confidence scores. A 45-confidence brief does not justify moving real money.
- Watch concentration: flag when a move pushes one position or one sector past a sensible share of the book, and don't create a new concentration while fixing an old one.
- Selling a winner has a tax consequence and selling a loser realises the loss; mention it where it plainly matters, without pretending to know their tax situation.
- State honestly what would make each action wrong.
- This is educational analysis for one individual's own decisions. It is not financial advice.`;

export interface SynthesisResult {
  portfolioView: string;
  method: string;
  actions: RebalanceAction[];
}

export async function synthesizeRebalance(args: {
  apiKey: string;
  model: string;
  reports: DeepResearchReport[];
  portfolio: PortfolioContext;
  signal?: AbortSignal;
}): Promise<SynthesisResult> {
  const { reports, portfolio } = args;

  const briefs = reports
    .map((r) => {
      const pillars = (
        [
          ['Filings', r.financials],
          ['Wall Street', r.wallStreet],
          ['Institutions', r.institutions],
          ['Politicians', r.politicians],
        ] as const
      )
        .map(([label, b]) => `    ${label} (strength ${b.strength}): ${b.summary}`)
        .join('\n');
      return `- ${r.symbol} (${r.name}) — ${r.owned ? 'OWNED' : 'candidate'} — verdict ${
        r.verdict
      }, confidence ${r.confidence}, suggested weight ${r.targetWeightPct ?? 0}%
${pillars}
    Reasoning: ${r.reasoning}
    Speculation: ${r.speculation}
    Sources: ${r.sources.slice(0, 6).map((s) => s.url).join(' | ')}`;
    })
    .join('\n\n');

  const book = portfolio.holdings
    .map(
      (h) =>
        `  ${h.symbol} — ${h.shares} sh @ $${h.price.toFixed(2)} = $${Math.round(
          h.valueUsd,
        ).toLocaleString('en-US')} (${h.weightPct.toFixed(1)}%, ${
          h.plPct >= 0 ? '+' : ''
        }${h.plPct.toFixed(1)}%, ${h.sector})`,
    )
    .join('\n');

  const candidates = reports
    .filter((r) => !r.owned)
    .map((r) => {
      const p = portfolio.prices[r.symbol];
      return p ? `${r.symbol} @ $${p.toFixed(2)}` : `${r.symbol} (no live price)`;
    })
    .join(', ');

  const user = `Today is ${portfolio.asOf}.

CURRENT HOLDINGS (total $${Math.round(portfolio.totalValueUsd).toLocaleString(
    'en-US',
  )}, cash available $${Math.round(portfolio.cashUsd).toLocaleString('en-US')}):
${book || '  (no holdings yet)'}
Sector weights: ${
    portfolio.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(', ') || 'n/a'
  }

RESEARCH BRIEFS:
${briefs}

Candidates not currently owned, with their current prices: ${candidates || '(none)'}

Write the portfolio view, then the actions. Every action must say precisely how many shares of what to sell and how many shares of what to buy with the proceeds.`;

  const raw = await groundedJson<Record<string, unknown>>({
    apiKey: args.apiKey,
    model: args.model,
    system: SYNTHESIS_SYSTEM,
    user,
    schema: ACTIONS_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8000,
    // No searching here — the grounding already happened in the briefs, and
    // this call is pure reasoning over them.
    maxSearches: 0,
    signal: args.signal,
  });

  return {
    portfolioView: str(raw.portfolioView),
    method: str(raw.method),
    actions: normalizeActions(raw.actions, portfolio, reports),
  };
}

const ACTION_KINDS = ['sell', 'trim', 'buy', 'add', 'hold', 'watch'] as const;
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const shareText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Rebuilds each action's numbers from live prices and real position sizes. The
 * model's arithmetic is treated as a suggestion, never as the figure shown.
 */
function normalizeActions(
  v: unknown,
  portfolio: PortfolioContext,
  reports: DeepResearchReport[],
): RebalanceAction[] {
  if (!Array.isArray(v)) return [];
  const held = new Map(portfolio.holdings.map((h) => [h.symbol, h]));
  const priceOf = (symbol: string): number | null =>
    portfolio.prices[symbol] ?? held.get(symbol)?.price ?? null;
  const knownUrls = new Set(reports.flatMap((r) => r.sources.map((s) => s.url)));
  let cashLeft = portfolio.cashUsd;

  const out: RebalanceAction[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = (v[i] ?? {}) as Record<string, unknown>;
    const kind = str(a.kind) as RebalanceAction['kind'];
    if (!ACTION_KINDS.includes(kind as (typeof ACTION_KINDS)[number])) continue;

    const sellSymbol = str(a.sellSymbol).toUpperCase() || undefined;
    const buySymbol = str(a.buySymbol).toUpperCase() || undefined;
    const holding = sellSymbol ? held.get(sellSymbol) : undefined;

    // Sell side: clamp to shares actually held, price it live.
    let sellShares = 0;
    let sellValueUsd = 0;
    if (holding) {
      const wanted = num(a.sellShares, 0);
      // Fall back to the dollar figure if the model only gave that.
      const impliedFromValue = holding.price > 0 ? num(a.sellValueUsd, 0) / holding.price : 0;
      sellShares = clamp(wanted > 0 ? wanted : impliedFromValue, 0, holding.shares);
      sellShares = Math.round(sellShares * 100) / 100;
      sellValueUsd = sellShares * holding.price;
    }

    // Buy side: prefer funding from the sale, otherwise from cash.
    let buyShares = 0;
    let buyValueUsd = 0;
    if (buySymbol) {
      const bp = priceOf(buySymbol);
      const budget = sellValueUsd > 0 ? sellValueUsd : Math.min(num(a.buyValueUsd, 0), cashLeft);
      buyValueUsd = Math.max(0, budget);
      if (bp && bp > 0) {
        buyShares = Math.round((buyValueUsd / bp) * 100) / 100;
      } else {
        // No live price for a candidate we don't own — keep the model's share
        // count if it gave one, and show the dollar amount as the instruction.
        buyShares = Math.max(0, Math.round(num(a.buyShares, 0) * 100) / 100);
      }
      if (sellValueUsd === 0) cashLeft = Math.max(0, cashLeft - buyValueUsd);
    }

    // Rebuild the headline so it can never disagree with the numbers above.
    let headline = str(a.headline);
    if (sellShares > 0 && buySymbol && buyValueUsd > 0) {
      headline = `Sell ${shareText(sellShares)} ${sellSymbol} (${money(
        sellValueUsd,
      )}) → buy ${buyShares > 0 ? `${shareText(buyShares)} ` : ''}${buySymbol} (${money(
        buyValueUsd,
      )})`;
    } else if (sellShares > 0) {
      headline = `${kind === 'sell' ? 'Sell' : 'Trim'} ${shareText(
        sellShares,
      )} ${sellSymbol} (${money(sellValueUsd)})`;
    } else if (buySymbol && buyValueUsd > 0) {
      headline = `Buy ${buyShares > 0 ? `${shareText(buyShares)} ` : ''}${buySymbol} (${money(
        buyValueUsd,
      )}) from cash`;
    }

    // An action that ends up moving nothing is guidance, not a trade.
    const movesNothing = sellShares === 0 && buyValueUsd === 0;
    if (movesNothing && kind !== 'hold' && kind !== 'watch') continue;

    out.push({
      id: `act-${i}-${sellSymbol ?? ''}${buySymbol ?? ''}`,
      kind,
      headline,
      sellSymbol: sellShares > 0 ? sellSymbol : undefined,
      sellShares: sellShares > 0 ? sellShares : undefined,
      sellValueUsd: sellShares > 0 ? sellValueUsd : undefined,
      buySymbol: buyValueUsd > 0 || buyShares > 0 ? buySymbol : undefined,
      buyShares: buyShares > 0 ? buyShares : undefined,
      buyValueUsd: buyValueUsd > 0 ? buyValueUsd : undefined,
      reasoning: str(a.reasoning),
      confidence: clamp(Math.round(num(a.confidence, 50)), 0, 100),
      risks: str(a.risks),
      // Only surface links that came out of the briefs — no invented citations.
      sourceUrls: strList(a.sourceUrls).filter((u) => knownUrls.has(u)),
    });
  }
  return out;
}

// ---- Display helpers ------------------------------------------------------

export function verdictLabel(v: ResearchVerdict): string {
  return {
    buy: 'Buy',
    accumulate: 'Accumulate',
    hold: 'Hold',
    trim: 'Trim',
    exit: 'Exit',
    avoid: 'Avoid',
  }[v];
}

export function confidenceLabel(c: number): string {
  if (c >= 80) return 'High conviction';
  if (c >= 65) return 'Reasonably confident';
  if (c >= 45) return 'Tentative';
  return 'Low confidence';
}

export const PILLAR_LABELS: Record<
  'financials' | 'wallStreet' | 'institutions' | 'politicians',
  { title: string; caveat: string }
> = {
  financials: {
    title: 'Financial statements',
    caveat: 'From company filings and earnings materials — audited, but backward-looking.',
  },
  wallStreet: {
    title: 'Wall Street & banks',
    caveat: 'Sell-side notes and price targets. Analysts are often late and rarely neutral.',
  },
  institutions: {
    title: 'Institutions & insiders',
    caveat:
      '13F filings are a quarter-end snapshot filed up to 45 days later. Insider sales happen for many reasons.',
  },
  politicians: {
    title: 'Congressional trading',
    caveat:
      'STOCK Act disclosures are public, lagged up to 45 days, and report dollar ranges rather than exact amounts. Weak, delayed signal — not inside information.',
  },
};
