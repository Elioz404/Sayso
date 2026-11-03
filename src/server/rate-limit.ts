// Who is calling, for per-address limits on public endpoints that cost money (onboarding runs the AI).
import 'server-only';
import { RateLimit } from '@/core/rate-limit.ts';

/** New shops per address per hour: each one is an AI call on the server's budget. */
export const onboarding = new RateLimit(10, 3_600_000);

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
