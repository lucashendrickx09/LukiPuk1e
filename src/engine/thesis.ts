import { ThesisInput, writeThesisWithClaude } from '@/api/anthropic';
import { Thesis } from '@/types';
import { fmtPct } from '@/utils/format';

// Template fallback: used when no Anthropic key is configured or the API call
// fails. Everything stated is derived from the structured signals, so the card
// stays truthful — just less fluent than the LLM version.
export function templateThesis(input: ThesisInput): Thesis {
  const { signals, metrics } = input;
  const bull: string[] = [];
  const bear: string[] = [];

  if (signals.analyst?.positive) {
    bull.push(
      `Analysts lean buy: ${Math.round(signals.analyst.buyRatio * 100)}% of ${signals.analyst.total} ratings are buy or strong-buy` +
        (signals.analyst.delta > 0.02 ? ', and that share is rising' : '') +
        '.',
    );
  }
  if (signals.news?.positive) {
    bull.push(
      `News flow is constructive — ${signals.news.articles} articles this week with clearly positive net tone.`,
    );
  }
  if (signals.filing?.positive) {
    bull.push('A fresh SEC filing confirms a real, recent corporate event behind the chatter.');
  }
  if (input.return3M !== null && input.return3M > 5) {
    bull.push(`Price momentum is intact: ${fmtPct(input.return3M)} over the last three months.`);
  }
  if (metrics.revenueGrowthTTMYoy !== undefined && metrics.revenueGrowthTTMYoy > 10) {
    bull.push(`Revenue grew ${metrics.revenueGrowthTTMYoy.toFixed(0)}% year over year.`);
  }
  if (bull.length === 0) bull.push('Multiple weak-positive signals aligned this week.');

  if (metrics.peTTM !== undefined && metrics.peTTM > 40) {
    bear.push(`Valuation is demanding at ~${metrics.peTTM.toFixed(0)}x trailing earnings.`);
  }
  if (signals.news && signals.news.score < 0.5) {
    bear.push('Coverage is positive on balance but not unanimous — read the source articles.');
  }
  if (input.return1M !== null && input.return1M > 12) {
    bear.push(
      `The stock already ran ${fmtPct(input.return1M)} in a month; some of the story may be priced in.`,
    );
  }
  bear.push('Template analysis only — add a Claude API key in Settings for a deeper thesis.');

  return {
    hook:
      signals.analyst?.positive && signals.news?.positive
        ? `Analysts and headlines agree on ${input.name} this week.`
        : `${input.name} is drawing unusually positive attention.`,
    blurb: `${input.name} (${input.symbol}) operates in ${input.sector}. It surfaced because ${
      signals.analyst?.positive ? 'analyst sentiment' : 'news coverage'
    } and at least one other independent source aligned positively in the last 7 days.`,
    bullCase: bull.slice(0, 4),
    bearCase: bear.slice(0, 3),
    generatedBy: 'template',
  };
}

export async function writeThesis(
  anthropicKey: string | null,
  model: string,
  input: ThesisInput,
): Promise<Thesis> {
  if (anthropicKey) {
    const llm = await writeThesisWithClaude(anthropicKey, model, input);
    if (llm) return llm;
  }
  return templateThesis(input);
}
