// Fixed-window rate limits for what costs money or quota per call (AI, PayPal, paid search). In-process:
// enough for one server, and each limit is per key (a shop, an address).

export class RateLimit {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, { start: number; count: number }>();
  /** Sweep expired windows once this many keys are tracked, so the map can't grow without bound. */
  private readonly sweepAt: number;
  private lastSweep = 0;

  constructor(limit: number, windowMs: number, sweepAt = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.sweepAt = sweepAt;
  }

  /** Counts one call for `key`; false once the key is over its limit for this window. */
  allow(key: string, now = Date.now()): boolean {
    // At most one sweep per window, so a crowd of callers doesn't make every call walk the whole map.
    if (this.windows.size >= this.sweepAt && now - this.lastSweep > this.windowMs) {
      this.lastSweep = now;
      for (const [k, w] of this.windows) if (now - w.start > this.windowMs) this.windows.delete(k);
    }
    const w = this.windows.get(key);
    if (!w || now - w.start > this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
