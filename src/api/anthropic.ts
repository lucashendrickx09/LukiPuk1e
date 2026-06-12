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
