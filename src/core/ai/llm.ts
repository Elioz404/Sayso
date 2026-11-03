// The one LLM interface Sayso uses, plus a client for any OpenAI-compatible chat API (DeepSeek by
// default). Every call asks for JSON; callers validate the result, the model's output is never
// trusted as-is.

export interface JsonRequest {
  system: string;
  user: string;
  /** Data URLs or https URLs. Only sent when the model supports image input. */
  images?: string[];
}

export interface ChatModel {
  readonly name: string;
  json(request: JsonRequest): Promise<unknown>;
}

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
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

export function openAICompatible(config: OpenAICompatibleConfig): ChatModel {
  const baseUrl = (config.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '');
  const model = config.model ?? 'deepseek-flash';
  const doFetch = config.fetch ?? fetch;

  async function call(request: JsonRequest, nudge?: string): Promise<string> {
    const userContent = request.images?.length
      ? [{ type: 'text', text: request.user }, ...request.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : request.user;
    const messages: unknown[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: userContent },
    ];
    if (nudge) messages.push({ role: 'user', content: nudge });

    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
    });
    if (!res.ok) throw new LlmError(`${model} returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
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

export function modelFromEnv(env: Record<string, string | undefined> = process.env): ChatModel | undefined {
  if (!env.DEEPSEEK_API_KEY) return undefined;
  return openAICompatible({ apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL });
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new LlmError('Model did not return valid JSON');
  }
}
