// Fixed-window, in-process rate limiting for the few endpoints that cost money (LLM calls).
import 'server-only';

const windows = new Map<string, { start: number; count: number }>();
/** Sweep expired windows once the map holds this many keys, so it can't grow without bound. */
const SWEEP_AT = 10_000;

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (windows.size >= SWEEP_AT) {
    for (const [k, w] of windows) if (now - w.start > windowMs) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

/**
 * The caller's address as our hosting edge saw it: Render sits behind Cloudflare, which sets
 * CF-Connecting-IP itself. Otherwise the proxy appends the real client to X-Forwarded-For, so the last
 * entry is the one a client cannot forge (earlier entries are whatever the client sent).
 */
export function clientAddress(request: Request): string {
  const hops = request.headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  return request.headers.get('cf-connecting-ip') ?? hops.at(-1) ?? 'local';
}
