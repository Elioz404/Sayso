'use client';

// The shopper's cart, kept in this browser: one list per shop, because each shop prices and gets paid for
// its own cart (PayPal's merchant-cart API is per shop). Nothing here is a price anyone pays: the shop
// prices the cart again on checkout, with shipping and tax, and that is the total PayPal shows.

import { useSyncExternalStore } from 'react';

export interface CartLine {
  variantId: string;
  productId: string;
  name: string;
  /** The variant's title ("Sage Green"), or empty when the product has one variant. */
  variant: string;
  /** Minor units, as shown on the shop page when it was added. */
  price: number;
  currency: string;
  image?: string;
  /** Most the shop can sell right now (made to order: a sensible cap). */
  max: number;
  qty: number;
}
export interface ShopCart {
  name: string;
  lines: CartLine[];
}
export type Carts = Record<string, ShopCart>;

const KEY = 'sayso-cart-v1';
const EMPTY: Carts = {};
let cache: Carts | undefined;
const listeners = new Set<() => void>();

function read(): Carts {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Carts;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Carts) {
  // Shops left with no lines drop out, so an empty cart is really empty.
  cache = Object.fromEntries(Object.entries(next).filter(([, c]) => c.lines.length > 0));
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage off or full: the cart still works on this page
  }
  listeners.forEach((l) => l());
}

export const cartStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      cache = undefined; // another tab changed it
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  },
  add(shop: { slug: string; name: string }, line: Omit<CartLine, 'qty'>, qty = 1) {
    const carts = read();
    const cart = carts[shop.slug] ?? { name: shop.name, lines: [] };
    const found = cart.lines.find((l) => l.variantId === line.variantId);
    const lines = found
      ? cart.lines.map((l) => (l.variantId === line.variantId ? { ...l, ...line, qty: Math.min(line.max, l.qty + qty) } : l))
      : [...cart.lines, { ...line, qty: Math.min(line.max, qty) }];
    write({ ...carts, [shop.slug]: { name: shop.name, lines } });
  },
  setQty(slug: string, variantId: string, qty: number) {
    const carts = read();
    const cart = carts[slug];
    if (!cart) return;
    const lines = cart.lines.flatMap((l) => (l.variantId !== variantId ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(l.max, qty) }]));
    write({ ...carts, [slug]: { ...cart, lines } });
  },
  clear(slug: string) {
    write(Object.fromEntries(Object.entries(read()).filter(([shop]) => shop !== slug)));
  },
};

/** The carts, live: every component using this re-renders when any of them changes (here or in another tab). */
export function useCarts(): Carts {
  return useSyncExternalStore(cartStore.subscribe, read, () => EMPTY);
}

export const itemCount = (carts: Carts) => Object.values(carts).reduce((n, c) => n + c.lines.reduce((m, l) => m + l.qty, 0), 0);

/** Asks the Shop with AI panel to open on the cart. */
export const OPEN_CART_EVENT = 'sayso:open-cart';
