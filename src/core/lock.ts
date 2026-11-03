// Serializes work per key inside this process: two checkouts of the same cart (a double-clicked return
// URL, a retrying platform) run one after the other, so the second sees the first one's result.
// Across processes, deterministic PayPal-Request-Ids make PayPal replay instead of repeating.

export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
