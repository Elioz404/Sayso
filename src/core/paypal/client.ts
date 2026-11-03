// Minimal PayPal REST client: OAuth client-credentials with token caching, retries on 401/429/5xx,
// PayPal-Request-Id idempotency on writes, and PayPal-Debug-Id captured on errors for the audit log.
// Plain fetch, server-side only.

export type PayPalEnv = 'sandbox' | 'live';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  env?: PayPalEnv;
  fetch?: typeof fetch;
}

export class PayPalError extends Error {
  readonly status: number;
  readonly path: string;
  readonly debugId?: string;
  readonly issue?: string;
  readonly body: unknown;

  constructor(status: number, path: string, body: unknown, debugId?: string) {
    const details = (body as { details?: { issue?: string; description?: string }[]; message?: string }) ?? {};
    const issue = details.details?.[0]?.issue;
    super(`PayPal ${status} on ${path}${issue ? ` (${issue})` : ''}: ${details.details?.[0]?.description ?? details.message ?? ''}`.trim());
    this.name = 'PayPalError';
    this.status = status;
    this.path = path;
    this.body = body;
    this.debugId = debugId;
    this.issue = issue;
  }
}

const BASE: Record<PayPalEnv, string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};
/** Where people sign in to PayPal (Log in with PayPal, onboarding links). */
const WEB: Record<PayPalEnv, string> = {
  sandbox: 'https://www.sandbox.paypal.com',
  live: 'https://www.paypal.com',
};

const MAX_ATTEMPTS = 4;
/** A PayPal call that hangs longer than this fails instead of holding the request (and a cart lock) open. */
const TIMEOUT_MS = 20_000;

export class PayPalClient {
  private readonly config: PayPalConfig;
  private readonly base: string;
  private token?: { value: string; expiresAt: number };

  constructor(config: PayPalConfig) {
    this.config = config;
    this.base = BASE[config.env ?? 'sandbox'];
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): PayPalClient {
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set');
    return new PayPalClient({ clientId, clientSecret, env: env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox' });
  }

  /** The app's client id: public, it appears in PayPal sign-in links. */
  get clientId(): string {
    return this.config.clientId;
  }

  /** PayPal's website for this environment, where people sign in. */
  get webBase(): string {
    return WEB[this.config.env ?? 'sandbox'];
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** A read on behalf of a person signed in with Log in with PayPal, with their token instead of the app's. */
  getAsUser<T>(path: string, userToken: string): Promise<T> {
    return this.request<T>('GET', path, undefined, { Authorization: `Bearer ${userToken}` });
  }

  /** Log in with PayPal: trade the one-time code PayPal sent back for that person's access token. */
  async userAccessToken(code: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const { access_token } = await this.tokenRequest<{ access_token: string }>(body);
    return access_token;
  }

  /** Writes always carry an idempotency key; pass the Guard record's key so retries are safe. */
  post<T>(path: string, body: unknown, idempotencyKey?: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, { ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}), ...extraHeaders });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const { access_token, expires_in } = await this.tokenRequest<{ access_token: string; expires_in: number }>(
      new URLSearchParams({ grant_type: 'client_credentials' }),
    );
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  private async tokenRequest<T>(body: URLSearchParams): Promise<T> {
    const doFetch = this.config.fetch ?? fetch;
    const res = await doFetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new PayPalError(res.status, '/v1/oauth2/token', await safeJson(res), res.headers.get('paypal-debug-id') ?? undefined);
    return (await res.json()) as T;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const doFetch = this.config.fetch ?? fetch;
    for (let attempt = 1; ; attempt++) {
      const res = await doFetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: headers.Authorization ?? `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

      if (res.status === 401 && attempt === 1 && !headers.Authorization) {
        this.token = undefined;
        continue;
      }
      // Retrying a write is only safe with an idempotency key; PayPal then replays the first result.
      const retryable = res.status === 429 || res.status >= 500;
      const safe = method === 'GET' || method === 'DELETE' || 'PayPal-Request-Id' in headers;
      if (retryable && safe && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 250));
        continue;
      }
      throw new PayPalError(res.status, path, await safeJson(res), res.headers.get('paypal-debug-id') ?? undefined);
    }
  }
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}
