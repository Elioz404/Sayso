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

/** Daily spend cap in USD, computed from token usage at the configured prices. */
export class Budget {
  readonly dailyLimitUsd: number;
  private readonly inPerMTok: number;
  private readonly outPerMTok: number;
  private day = '';
  private spent = 0;
  private calls = 0;

  constructor(dailyLimitUsd: number, inPerMTok: number, outPerMTok: number) {
    this.dailyLimitUsd = dailyLimitUsd;
    this.inPerMTok = inPerMTok;
    this.outPerMTok = outPerMTok;
  }

  check(now = new Date()): void {
    this.roll(now);
    if (this.spent >= this.dailyLimitUsd) {
      throw new LlmError(`Today's AI budget ($${this.dailyLimitUsd.toFixed(2)}) is used up. Try again tomorrow, or add products by hand.`, 429);
    }
  }

  record(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, now = new Date()): number {
    this.roll(now);
    const cost = ((usage?.prompt_tokens ?? 0) * this.inPerMTok + (usage?.completion_tokens ?? 0) * this.outPerMTok) / 1_000_000;
    this.spent += cost;
    this.calls += 1;
    return cost;
  }

  status(now = new Date()): { day: string; spentUsd: number; limitUsd: number; calls: number } {
    this.roll(now);
    return { day: this.day, spentUsd: Math.round(this.spent * 10_000) / 10_000, limitUsd: this.dailyLimitUsd, calls: this.calls };
  }

  private roll(now: Date): void {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spent = 0;
      this.calls = 0;
    }
  }
}

export function openAICompatible(config: OpenAICompatibleConfig): ChatModel {
  const provider = config.provider ?? 'deepseek';
  const baseUrl = (config.baseUrl ?? (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com')).replace(/\/$/, '');
  const model = config.model ?? (provider === 'openai' ? 'gpt-4.1-mini' : 'deepseek-flash');
  const doFetch = config.fetch ?? fetch;

  async function call(request: JsonRequest, nudge?: string): Promise<string> {
    config.budget?.check();
    const image = (url: string) => ({ type: 'image_url', image_url: provider === 'openai' ? { url, detail: config.imageDetail ?? 'low' } : { url } });
    const userContent = request.images?.length ? [{ type: 'text', text: request.user }, ...request.images.map(image)] : request.user;
    const messages: unknown[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: userContent },
    ];
    if (nudge) messages.push({ role: 'user', content: nudge });

    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: request.maxOutputTokens ?? 1_200,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new LlmError(`${model} returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    config.budget?.record(body.usage);
    if (body.choices?.[0]?.finish_reason === 'length') throw new LlmError('The reply was too long; send fewer products at a time.');
    return body.choices?.[0]?.message?.content ?? '';
  }

  return {
    name: model,
    async json(request) {
      const first = await call(request);
      try {
        return parseJson(first);
      } catch {
        // One retry: models occasionally wrap JSON in prose or code fences.
        return parseJson(await call(request, 'Reply with the JSON object only, no prose.'));
      }
    },
  };
}

/**
 * OpenAI when OPENAI_API_KEY is set (default gpt-4.1-mini), otherwise DeepSeek when DEEPSEEK_API_KEY
 * is set. AI_PROVIDER forces one. AI_DAILY_BUDGET_USD caps spend per day (default $0.50).
 */
export function modelFromEnv(env: Record<string, string | undefined> = process.env): { model: ChatModel; budget: Budget } | undefined {
  const provider = env.AI_PROVIDER === 'deepseek' || env.AI_PROVIDER === 'openai' ? env.AI_PROVIDER : env.OPENAI_API_KEY ? 'openai' : env.DEEPSEEK_API_KEY ? 'deepseek' : undefined;
  if (!provider) return undefined;
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.DEEPSEEK_API_KEY;
  if (!apiKey) return undefined;

  const prices = provider === 'openai' ? [0.4, 1.6] : [0.14, 0.28];
  const budget = new Budget(
    positive(env.AI_DAILY_BUDGET_USD) ?? 0.5,
    positive(env.AI_PRICE_INPUT_PER_MTOK) ?? prices[0],
    positive(env.AI_PRICE_OUTPUT_PER_MTOK) ?? prices[1],
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
