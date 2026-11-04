// The one LLM interface Sayso uses, plus a client for any OpenAI-compatible chat API (OpenAI or
// DeepSeek). Every call asks for JSON; callers validate the result, the model's output is never
// trusted as-is. Spend is metered from the API's own usage numbers and capped per day.

export interface JsonRequest {
  system: string;
  user: string;
  /** Data URLs or https URLs. Only sent when the model supports image input. */
  images?: string[];
  /** Upper bound on the reply, so one call can't run up the bill. */
  maxOutputTokens?: number;
}

export interface ChatModel {
  readonly name: string;
  json(request: JsonRequest): Promise<unknown>;
}

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** OpenAI takes `max_completion_tokens` and an image `detail`; DeepSeek takes `max_tokens`. */
  provider?: 'openai' | 'deepseek';
  /** "low" sends each photo at 512px for a small fixed token cost. */
  imageDetail?: 'low' | 'high' | 'auto';
  budget?: Budget;
  fetch?: typeof fetch;
}

export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** Where the day's AI spend is kept, so a restart or a deploy doesn't reset the cap. */
export interface SpendStore {
  /** USD spent and calls made on `day` (YYYY-MM-DD, UTC). */
  get(day: string): Promise<{ usd: number; calls: number }>;
  add(day: string, usd: number): Promise<void>;
}

export class MemorySpendStore implements SpendStore {
  private readonly days = new Map<string, { usd: number; calls: number }>();
  async get(day: string) {
    return { ...(this.days.get(day) ?? { usd: 0, calls: 0 }) };
  }
  async add(day: string, usd: number) {
    const now = this.days.get(day) ?? { usd: 0, calls: 0 };
    this.days.set(day, { usd: now.usd + usd, calls: now.calls + 1 });
  }
}

/** A call's place in the budget, held from before it starts until its real cost is known. */
export interface Reservation {
  day: string;
  usd: number;
}

/**
 * Daily spend cap in USD, computed from token usage at the configured prices. Each call reserves what
 * it could cost before it starts, so calls running at the same time can't all slip under the cap.
 */
export class Budget {
  readonly dailyLimitUsd: number;
  private readonly inPerMTok: number;
  private readonly outPerMTok: number;
  private readonly store: SpendStore;
  private pending = 0;

  constructor(dailyLimitUsd: number, inPerMTok: number, outPerMTok: number, store: SpendStore = new MemorySpendStore()) {
    this.dailyLimitUsd = dailyLimitUsd;
    this.inPerMTok = inPerMTok;
    this.outPerMTok = outPerMTok;
    this.store = store;
  }

  /** Hold room for one call of up to `maxOutputTokens`; refused once the day's budget is used up. */
  async reserve(maxOutputTokens: number, now = new Date()): Promise<Reservation> {
    const day = dayOf(now);
    const { usd } = await this.store.get(day);
    if (usd + this.pending >= this.dailyLimitUsd) {
      throw new LlmError(`Today's AI budget ($${this.dailyLimitUsd.toFixed(2)}) is used up. Try again tomorrow, or add products by hand.`, 429);
    }
    const estimate = (ESTIMATED_INPUT_TOKENS * this.inPerMTok + maxOutputTokens * this.outPerMTok) / 1_000_000;
    this.pending += estimate;
    return { day, usd: estimate };
  }

  /** The call finished (or failed): release its hold and record what it really cost. */
  async settle(reservation: Reservation, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): Promise<number> {
    this.pending = Math.max(0, this.pending - reservation.usd);
    if (!usage) return 0;
    const cost = ((usage.prompt_tokens ?? 0) * this.inPerMTok + (usage.completion_tokens ?? 0) * this.outPerMTok) / 1_000_000;
    await this.store.add(reservation.day, cost);
    return cost;
  }

  async status(now = new Date()): Promise<{ day: string; spentUsd: number; limitUsd: number; calls: number }> {
    const day = dayOf(now);
    const { usd, calls } = await this.store.get(day);
    return { day, spentUsd: Math.round(usd * 10_000) / 10_000, limitUsd: this.dailyLimitUsd, calls };
  }
}

/** A typical request with a downscaled photo; used only to hold room before the real usage is known. */
const ESTIMATED_INPUT_TOKENS = 3_000;
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

export function openAICompatible(config: OpenAICompatibleConfig): ChatModel {
  const provider = config.provider ?? 'deepseek';
  const baseUrl = (config.baseUrl ?? (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com')).replace(/\/$/, '');
  const model = config.model ?? (provider === 'openai' ? 'gpt-4.1-mini' : 'deepseek-flash');
  const doFetch = config.fetch ?? fetch;

  /** One request. `fix`: the model's earlier answer and what to change, sent without the photos again. */
  async function call(request: JsonRequest, fix?: { previous: string; nudge: string }): Promise<string> {
    const maxOutputTokens = request.maxOutputTokens ?? 1_200;
    const reservation = await config.budget?.reserve(maxOutputTokens);
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    try {
      const image = (url: string) => ({ type: 'image_url', image_url: provider === 'openai' ? { url, detail: config.imageDetail ?? 'low' } : { url } });
      const userContent = request.images?.length && !fix ? [{ type: 'text', text: request.user }, ...request.images.map(image)] : request.user;
      const messages: unknown[] = [
        { role: 'system', content: request.system },
        { role: 'user', content: userContent },
      ];
      if (fix) messages.push({ role: 'assistant', content: fix.previous.slice(0, 20_000) }, { role: 'user', content: fix.nudge });
      const body = await post(messages, maxOutputTokens);
      usage = body.usage;
      if (body.choices?.[0]?.finish_reason === 'length') throw new LlmError('The reply was too long; send fewer products at a time.');
      return body.choices?.[0]?.message?.content ?? '';
    } finally {
      if (reservation) await config.budget!.settle(reservation, usage);
    }
  }

  async function post(messages: unknown[], maxOutputTokens: number) {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxOutputTokens,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new LlmError(`${model} returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    return (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  }

  return {
    name: model,
    async json(request) {
      const first = await call(request);
      try {
        return parseJson(first);
      } catch {
        // One retry: models occasionally wrap JSON in prose or code fences. It only needs its own answer
        // back, not the photos, so the retry costs a fraction of the first call.
        return parseJson(await call(request, { previous: first, nudge: 'Reply with the JSON object only, no prose.' }));
      }
    },
  };
}

/**
 * OpenAI when OPENAI_API_KEY is set (default gpt-4.1-mini), otherwise DeepSeek when DEEPSEEK_API_KEY
 * is set. AI_PROVIDER forces one. AI_DAILY_BUDGET_USD caps spend per day (default $0.50).
 */
export function modelFromEnv(env: Record<string, string | undefined> = process.env, spend?: SpendStore): { model: ChatModel; budget: Budget } | undefined {
  const provider = env.AI_PROVIDER === 'deepseek' || env.AI_PROVIDER === 'openai' ? env.AI_PROVIDER : env.OPENAI_API_KEY ? 'openai' : env.DEEPSEEK_API_KEY ? 'deepseek' : undefined;
  if (!provider) return undefined;
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.DEEPSEEK_API_KEY;
  if (!apiKey) return undefined;

  const prices = provider === 'openai' ? [0.4, 1.6] : [0.14, 0.28];
  const budget = new Budget(
    positive(env.AI_DAILY_BUDGET_USD) ?? 0.5,
    positive(env.AI_PRICE_INPUT_PER_MTOK) ?? prices[0],
    positive(env.AI_PRICE_OUTPUT_PER_MTOK) ?? prices[1],
    spend,
  );
  const model = openAICompatible({
    provider,
    apiKey,
    baseUrl: provider === 'openai' ? env.OPENAI_BASE_URL : env.DEEPSEEK_BASE_URL,
    model: provider === 'openai' ? env.OPENAI_MODEL : env.DEEPSEEK_MODEL,
    imageDetail: env.AI_IMAGE_DETAIL === 'high' || env.AI_IMAGE_DETAIL === 'auto' ? env.AI_IMAGE_DETAIL : 'low',
    budget,
  });
  return { model, budget };
}

function positive(value: string | undefined): number | undefined {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new LlmError('Model did not return valid JSON');
  }
}
