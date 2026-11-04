// Who is calling, for per-address limits on public endpoints that cost money (onboarding runs the AI).
import 'server-only';
import { HttpError } from '@/core/errors.ts';
import { RateLimit } from '@/core/rate-limit.ts';

/** New shops per address per hour: each one is an AI call on the server's budget. */
export const onboarding = new RateLimit(10, 3_600_000);
/** Judge tours per address per hour: each one is a shop copy and real sandbox PayPal calls. */
export const tourStarts = new RateLimit(5, 3_600_000);

/**
 * The caller's address as our hosting edge saw it. The proxy appends the real client to
 * X-Forwarded-For, so the last entry is the one a client cannot forge (earlier entries are whatever the
 * client sent). CF-Connecting-IP is only believed when SAYSO_TRUST_CF_IP=true says a Cloudflare edge
 * sets it; anywhere else a client could send its own.
 */
export function clientAddress(request: Request): string {
  if (process.env.SAYSO_TRUST_CF_IP === 'true') {
    const cf = request.headers.get('cf-connecting-ip');
    if (cf) return cf;
  }
  const hops = request.headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  return hops.at(-1) ?? 'local';
}
/** Photo reads per shop per hour (drafting products, reading shipping labels): each is an AI call. */
export const photoReads = new RateLimit(30, 3_600_000);
/** MCP requests per address per minute, any tool: keeps one client from flooding the server. */
export const mcpRequests = new RateLimit(120, 60_000);
/**
 * Calls per address per hour that reach PayPal on the app's credentials (new orders, saved-PayPal
 * setups, refunds) or the AI. PayPal throttles the whole app, so one caller must not use it all up.
 */
export const costlyCalls = { paypal: new RateLimit(40, 3_600_000), ai: new RateLimit(20, 3_600_000) } as const;
/** For REST routes that call the AI: refuse past the caller's hourly share. */
export function limitAi(request: Request): void {
  if (!costlyCalls.ai.allow(clientAddress(request))) throw new HttpError(429, 'Too many photo reads from here; wait a few minutes and try again.');
}

/** A test notification per shop per minute: enough to check it works, not enough to spam a phone. */
export const testPushes = new RateLimit(1, 60_000);

/** For REST routes that reach PayPal on the app's credentials: refuse past the caller's hourly share. */
export function limitPayPal(request: Request): void {
  if (!costlyCalls.paypal.allow(clientAddress(request))) throw new HttpError(429, 'Too many requests from here; wait a few minutes and try again.');
}
