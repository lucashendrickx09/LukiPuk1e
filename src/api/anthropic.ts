import Anthropic from '@anthropic-ai/sdk';
import { KeyMetrics, SignalSummary, Thesis } from '@/types';

// The thesis writer is the only paid step in the pipeline. The default model
// is Haiku-class per the product spec (~10 theses/day ≈ a few dollars/month);
// the model is user-configurable in Settings.
export const DEFAULT_THESIS_MODEL = 'claude-haiku-4-5';
export const THESIS_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'];

const THESIS_SCHEMA = {
  type: 'object',
  properties: {
    hook: {
      type: 'string',
      description: 'One punchy sentence: the main selling point / appeal of this stock right now.',
    },
    blurb: {
      type: 'string',
      description: 'What the company does, in 2-3 plain-language sentences for a retail investor.',
    },
    bullCase: {
      type: 'array',
      items: { type: 'string' },
      description: '3-4 short bullet points: why you might buy. Ground each in the provided signals.',
    },
    bearCase: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 short bullet points: why you might not buy. Be honest about risks.',
    },
  },
  required: ['hook', 'blurb', 'bullCase', 'bearCase'],
  additionalProperties: false,
} as const;

const SYSTEM = `You write concise, honest stock research cards for a personal investing app.
You receive structured signal data for one company: analyst recommendation trends, recent news headlines, key fundamentals, and price momentum.
Write for a smart retail investor. Be specific — reference the actual signals you were given (e.g. "analyst buy ratio rose to 68%", a concrete headline theme). Never invent numbers or events that are not in the input.
This is educational analysis, not financial advice; keep the tone factual rather than promotional, and make the bear case genuinely substantive.`;

export interface ThesisInput {
  symbol: string;
  name: string;
  sector: string;
  capTier: string;
  price: number;
  longTermScore: number;
  momentumScore: number;
  signals: SignalSummary;
  metrics: KeyMetrics;
  return1M: number | null;
  return3M: number | null;
}

export async function writeThesisWithClaude(
  apiKey: string,
  model: string,
  input: ThesisInput,
): Promise<Thesis | null> {
  try {
    // dangerouslyAllowBrowser: the key is the user's own, entered in Settings
    // and stored in the device keychain — this is a personal single-user app.
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            'Write the research card for this company based on these signals:\n' +
            JSON.stringify(input, null, 1),
        },
      ],
      output_config: { format: { type: 'json_schema', schema: THESIS_SCHEMA } },
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as Omit<Thesis, 'generatedBy'>;
    if (!parsed.hook || !Array.isArray(parsed.bullCase) || !Array.isArray(parsed.bearCase)) {
      return null;
    }
    return { ...parsed, generatedBy: 'llm' };
  } catch {
    return null;
  }
}

// ---- Claude web-search deck discovery -----------------------------------
// One grounded call: Claude searches live sources and returns both the picks
// AND their analysis. Used as the deck engine when an Anthropic key is set.

export interface ClaudeCandidate {
  ticker: string;
  name: string;
  sector: string;
  capTier?: string;
  hook: string;
  blurb: string;
  bullCase: string[];
  bearCase: string[];
  longTermScore?: number;
  momentumScore?: number;
  sources?: { title: string; url: string }[];
}

const DISCOVER_SYSTEM = `You are a rigorous equity analyst. ALWAYS use the web_search tool to research before answering — never rely on memory for prices, ratings, or recent events. Find US-listed (NYSE/NASDAQ) stocks showing genuine current potential, where recent credible sources (news, analyst notes, earnings, well-known investors) point to upside, ideally corroborated by more than one source. Every claim in your output must be grounded in something you actually found via search; do not invent figures or events. Prefer liquid, well-known-enough names; avoid microcaps and penny stocks.`;

function extractJsonArray(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON array in response');
  return JSON.parse(t.slice(start, end + 1));
}

export async function discoverCandidates(
  apiKey: string,
  model: string,
  opts: { count: number; styleLean: 'longterm' | 'balanced' | 'momentum'; exclude: string[] },
): Promise<ClaudeCandidate[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const style =
    opts.styleLean === 'longterm'
      ? 'long-term buy-and-hold (durable quality, sane valuation)'
      : opts.styleLean === 'momentum'
        ? 'growth and momentum (catalysts, accelerating attention)'
        : 'balanced (quality plus momentum)';
  const user = `Find ${opts.count} US-listed stocks with strong CURRENT potential for a ${style} investor.
Exclude these tickers (already owned or seen): ${opts.exclude.join(', ') || '(none)'}.
Search the web first, then reply with ONLY a JSON array (no markdown, no prose) of exactly this shape:
[{"ticker":"NVDA","name":"NVIDIA","sector":"Semiconductors","capTier":"Mega-cap","hook":"one punchy sentence","blurb":"2-3 sentences on what they do and why now","bullCase":["point","point","point"],"bearCase":["risk","risk"],"longTermScore":78,"momentumScore":84,"sources":[{"title":"headline","url":"https://..."}]}]
Rules: capTier is one of Mega-cap | Large-cap | Mid-cap | Small-cap. Scores are 0-100. Include 2-4 real source links per stock from your search.`;

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: DISCOVER_SYSTEM,
    // Server-side web search; max_uses caps the (paid) searches per build.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] as any,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined the request');
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) throw new Error('Claude did not return a list');

  const out: ClaudeCandidate[] = [];
  for (const raw of parsed) {
    const c = raw as Partial<ClaudeCandidate>;
    if (
      typeof c.ticker !== 'string' ||
      typeof c.hook !== 'string' ||
      typeof c.blurb !== 'string' ||
      !Array.isArray(c.bullCase) ||
      !Array.isArray(c.bearCase)
    ) {
      continue;
    }
    out.push({
      ticker: c.ticker.toUpperCase().trim(),
      name: typeof c.name === 'string' ? c.name : c.ticker,
      sector: typeof c.sector === 'string' ? c.sector : 'Unknown',
      capTier: typeof c.capTier === 'string' ? c.capTier : undefined,
      hook: c.hook,
      blurb: c.blurb,
      bullCase: c.bullCase.filter((x): x is string => typeof x === 'string'),
      bearCase: c.bearCase.filter((x): x is string => typeof x === 'string'),
      longTermScore: typeof c.longTermScore === 'number' ? c.longTermScore : undefined,
      momentumScore: typeof c.momentumScore === 'number' ? c.momentumScore : undefined,
      sources: Array.isArray(c.sources)
        ? c.sources
            .filter((s): s is { title: string; url: string } => !!s && typeof s.url === 'string')
            .map((s) => ({ title: typeof s.title === 'string' ? s.title : s.url, url: s.url }))
        : [],
    });
  }
  return out;
}
