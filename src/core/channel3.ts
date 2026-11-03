// Channel3 product search (https://channel3.ai/docs): normalized products and offers across retailers.
// Sayso uses it as the listing source for market prices; only in-stock offers count.

import type { Listing, ListingSource } from './market.ts';
import { parseAmount } from './money.ts';

const API = 'https://api.trychannel3.com/v1';
const TIMEOUT_MS = 10_000;

interface Channel3Offer {
  url: string;
  domain: string;
  price: { price: number; currency: string };
  availability: string;
}

interface Channel3Product {
  id: string;
  title: string;
  offers?: Channel3Offer[];
}

export class Channel3 implements ListingSource {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;

  constructor(apiKey: string, doFetch: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetch = doFetch;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): Channel3 | undefined {
    return env.CHANNEL3_API_KEY ? new Channel3(env.CHANNEL3_API_KEY) : undefined;
  }

  async search(query: string, limit: number): Promise<Listing[]> {
    const res = await this.fetch(`${API}/search`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, filters: { availability: ['InStock'] } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Channel3 answered ${res.status}`);
    const { products = [] } = (await res.json()) as { products?: Channel3Product[] };
    // One listing per product: its cheapest in-stock offer, as a shopper would find it.
    return products.flatMap((p) => {
      const listings = (p.offers ?? []).flatMap((o) => {
        if (o.availability !== 'InStock') return [];
        const price = parseAmount(o.price.price, o.price.currency);
        return price ? [{ title: p.title, store: o.domain, price, currency: o.price.currency, url: o.url }] : [];
      });
      const cheapest = listings.sort((a, b) => a.price - b.price)[0];
      return cheapest ? [cheapest] : [];
    });
  }
}
