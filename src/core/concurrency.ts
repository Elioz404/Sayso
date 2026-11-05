// Work on many items without sending all of them to an external API at once: PayPal throttles the whole
// app, so a page that reads 100 invoices reads them a few at a time.

/** `fn` over every item, at most `limit` at a time, results in the items' order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A cache that forgets its least recently written entries past `max`, so it can't grow forever. */
export class BoundedCache<K, V> {
  private readonly max: number;
  private readonly entries = new Map<K, V>();
  constructor(max: number) {
    this.max = max;
  }
  get(key: K): V | undefined {
    return this.entries.get(key);
  }
  set(key: K, value: V): void {
    this.entries.delete(key); // re-inserting moves it to the newest end
    this.entries.set(key, value);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as K);
  }
  delete(key: K): boolean {
    return this.entries.delete(key);
  }
}
