'use client';

// The shopping assistant: the person types what they want, the assistant uses Sayso's buyer tools (the
// same ones any assistant gets over MCP) and each tool call shows as it happened. No account: PayPal
// knows the buyer when they pay, and the conversation (with its cart and order) is kept in this browser,
// so they can come back after paying and ask where the order is or for a refund. The server checks and
// caps the conversation on every turn.

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, toMinor } from '@/core/money.ts';
import { callApi } from './api.ts';
import { ordersInThisBrowser } from './order-list.tsx';
import { PayPalCheckout, type Paid } from './paypal-checkout.tsx';
import { PurchaseCard, paymentWords, splitName, type Purchase } from './purchase-card.tsx';

type Money = { currency_code: string; value: string };
/** What create_cart, update_cart and get_cart return, as far as the chat reads it. */
type CartResult = {
  shop?: string;
  cart_id?: string;
  status?: string;
  approval_url?: string;
  items?: { name?: string; quantity: number; price?: Money; variant_id?: string }[];
  totals?: { subtotal?: Money; shipping?: Money; tax?: Money; total?: Money };
  order?: { number?: string; payment?: string; refunded?: string; tracking?: { carrier: string; number: string } | string };
  payment_confirmation?: { merchant_order_number?: string; payment_status?: string };
};
/** A paid cart, kept with the conversation so a reload or another page never offers to pay it again. */
type PaidCart = Paid & { at?: string };

const show = (m?: Money) => (m ? formatMoney(toMinor(m), m.currency_code) : undefined);
const CART_TOOLS = ['create_cart', 'update_cart'];

type Found = { name: string; url: string; image?: string; shop: string; from: string; note?: string };

/** The products a search step found, to show as cards (photo, shop, price, link to the product). */
function foundProducts(step: Step): Found[] {
  if (!('tool' in step) || step.isError || step.tool !== 'search_products') return [];
  const r = (step.result ?? {}) as { results?: { name?: string; products?: any[] }[]; shop?: { name?: string }; products?: any[] };
  const groups = r.results ?? [{ name: r.shop?.name, products: r.products }];
  return groups
    .flatMap((g) =>
      (g.products ?? []).map((p) => {
        const variants = (p.variants ?? []) as { price: string; in_stock: number | string }[];
        const prices = variants.map((v) => v.price);
        const cheapest = prices.sort((a, b) => parseFloat(a.replace(/[^0-9.]/g, '')) - parseFloat(b.replace(/[^0-9.]/g, '')))[0];
        const madeToOrder = variants.some((v) => typeof v.in_stock === 'string');
        return { name: p.name, url: p.url, image: p.image, shop: g.name ?? '', from: cheapest ?? '', note: madeToOrder ? 'Made to order' : undefined };
      }),
    )
    .filter((p) => p.url)
    .slice(0, 6);
}

function ProductCards({ items }: { items: Found[] }) {
  return (
    <div className="pcards" role="list">
      {items.map((p) => (
        <a key={p.url} className="pcard" href={p.url} role="listitem">
          <span className="pcard-photo">{p.image && <img src={p.image} alt="" loading="lazy" />}</span>
          <span className="pcard-body">
            <b>{p.name}</b>
            <span className="small muted">{p.shop}</span>
            <span className="small">
              {p.from && `from ${p.from}`}
              {p.note ? ` · ${p.note}` : ''}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

/** The cart a tool step returned, if it is ready to pay. */
function payableCart(step: Step): { cartId: string; orderId: string; currency: string; approvalUrl: string } | undefined {
  if (!('tool' in step) || step.isError || !['create_cart', 'update_cart'].includes(step.tool)) return undefined;
  const r = (step.result ?? {}) as { cart_id?: string; status?: string; approval_url?: string; totals?: { total?: { currency_code?: string } } };
  const orderId = r.approval_url ? new URL(r.approval_url).searchParams.get('token') : null;
  if (!r.cart_id || !orderId || r.status === 'COMPLETED') return undefined;
  return { cartId: r.cart_id, orderId, currency: r.totals?.total?.currency_code ?? 'USD', approvalUrl: r.approval_url! };
}

type Step = { tool: string; args: unknown; result: unknown; isError: boolean } | { text: string };
/** `hidden`: a turn the page sent for the person (after paying), shown as the receipt instead of as chat. */
type Turn = { user: string; steps: Step[]; hidden?: boolean };

const SAVED = 'sayso-shopper-v1';
const SUGGESTIONS = ['A handmade mug under $40, as a gift', 'Something for a ramen lover', 'What shops can I buy from?'];

/** A short line about what a tool returned, for the person watching. */
function summary(tool: string, result: unknown, isError: boolean): string {
  if (isError) return String(result).slice(0, 120);
  const r = (result ?? {}) as Record<string, any>;
  switch (tool) {
    case 'list_shops':
      return `${(r.result ?? r).length ?? 0} shop(s)`;
    case 'search_products': {
      const n = (r.results ?? [r]).reduce((a: number, s: any) => a + (s.products?.length ?? 0), 0);
      return n ? `${n} product${n === 1 ? '' : 's'} found` : 'nothing matched';
    }
    case 'create_cart':
    case 'update_cart':
      return r.validation_issues?.length ? r.validation_issues[0].user_message ?? r.validation_issues[0].message : `cart ready · ${r.totals?.total?.value ? `$${r.totals.total.value}` : r.status}`;
    case 'get_cart':
      return r.order ? `${r.order.payment}${r.order.refunded && r.order.refunded !== 'nothing' ? ` · refunded ${r.order.refunded}` : ''}` : r.status;
    case 'request_refund':
      return `${r.amount ?? ''} · ${r.status ?? ''}`;
    default:
      return r.status ?? '';
  }
}

/** Plain text with markdown links and bold, as the model writes them. PayPal links become the PayPal button. */
function Rich({ text }: { text: string }) {
  // Models sometimes slip ("[Pay with PayPal].(url)") or paste a bare URL; both still become a proper link.
  const tidy = text
    .replace(/\[([^\]]+)\]\.?\s*\((https?:\/\/[^)\s]+)\)/g, '[$1]($2)')
    .replace(/(^|[^(\w])(https?:\/\/[^\s)]+[^\s).,])/g, (_, lead: string, url: string) => `${lead}[${/paypal\.com/.test(url) ? 'Pay with PayPal' : url}](${url})`);
  const parts = tidy.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*)/);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (link) {
          const pay = /paypal\.com/.test(link[2]);
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" title={pay ? 'Opens PayPal in a new tab' : undefined}>
              {pay ? 'open PayPal in a new tab' : link[1]}
            </a>
          );
        }
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        return bold ? <b key={i}>{bold[1]}</b> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Orders the assistant should know about: the one on this page (an order page), then those paid in this browser. */
function ordersInView(): string[] {
  const onPage = window.location.pathname.match(/^\/order\/([\w-]{6,60})$/)?.[1];
  return [...new Set([...(onPage ? [onPage] : []), ...ordersInThisBrowser()])].slice(0, 10);
}

/** `request`: a message sent from elsewhere on the page ("Buy with AI"); it continues the conversation. */
export function ShopperChat({ paypalClientId, request, compact = false }: { paypalClientId?: string; request?: { text: string; id: number }; compact?: boolean }) {
  const [history, setHistory] = useState<unknown[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<false | 'thinking' | 'confirming'>(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  const [paid, setPaid] = useState<Record<string, PaidCart>>({});
  // Carts the person cancelled before paying (nothing is held or charged until PayPal approval), and the
  // ones the assistant hasn't been told about yet: it hears on the next message.
  const [cancelled, setCancelled] = useState<string[]>([]);
  const [untold, setUntold] = useState<string[]>([]);
  const onPaidFor = useRef(new Map<string, (p: Paid) => void>());
  const loaded = useRef(false);
  // Keep the conversation, what was paid and what was cancelled in this browser. Declared before the load
  // below, so the first pass doesn't save an empty chat over the saved one. A turn still waiting for its
  // answer isn't saved.
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ history, turns: turns.filter((t) => t.steps.length), paid, cancelled, untold }));
    } catch {
      // full or off: the conversation still works in this tab
    }
  }, [history, turns, paid, cancelled, untold]);
  // Pick the conversation back up (after paying in PayPal, a reload, another page); storage may be off.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as { history: unknown[]; turns: Turn[]; paid?: Record<string, PaidCart>; cancelled?: string[]; untold?: string[] } | null;
      if (saved?.turns?.length) {
        setHistory(saved.history);
        setTurns(saved.turns);
        setPaid(saved.paid ?? {});
        setCancelled(saved.cancelled ?? []);
        setUntold(saved.untold ?? []);
      }
    } catch {
      // nothing saved, or storage is off: start fresh
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (request) void send(request.text);
    // A new request is a new id; `send` is this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  function startOver() {
    setHistory([]);
    setTurns([]);
    setPaid({});
    setCancelled([]);
    setUntold([]);
    setError(undefined);
    try {
      localStorage.removeItem(SAVED);
    } catch {
      // nothing to clear
    }
  }
  // Follow the conversation inside its own box; the page itself stays where the person left it.
  useEffect(() => {
    if (log.current) log.current.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(message: string, hidden = false) {
    const said = message.trim();
    if (!said || busy) return;
    setBusy(hidden ? 'confirming' : 'thinking');
    setError(undefined);
    if (!hidden) setText('');
    setTurns((t) => [...t, { user: said, steps: [], ...(hidden ? { hidden } : {}) }]);
    // The assistant hears about carts cancelled since its last turn, ahead of what the person says.
    const told = untold;
    const note = told.length ? `(I cancelled ${told.length === 1 ? 'the cart' : 'the carts'} ${told.join(', ')} before paying; don't offer ${told.length === 1 ? 'it' : 'them'} again unless I ask.) ` : '';
    try {
      const reply = await callApi<{ messages: unknown[]; steps: Step[] }>('/api/shopper', 'POST', { messages: history, text: (note + said).slice(0, 600), orders: ordersInView() });
      if (told.length) setUntold((u) => u.filter((id) => !told.includes(id)));
      setHistory(reply.messages);
      setTurns((t) => [...t.slice(0, -1), { user: said, steps: reply.steps, ...(hidden ? { hidden } : {}) }]);
    } catch (err) {
      setError((err as Error).message);
      setTurns((t) => t.slice(0, -1));
      if (!hidden) setText(said);
    } finally {
      setBusy(false);
    }
  }

  const steps = useMemo(() => turns.flatMap((t) => t.steps), [turns]);
  // What the conversation already knows, to dress a cart as a purchase: shop names, product photos, which
  // shop each cart is from, the shop's latest word on each order, and each cart's newest version.
  const known = useMemo(() => {
    const shops = new Map<string, string>();
    const images = new Map<string, string>();
    const cartShop = new Map<string, string>();
    const latest = new Map<string, CartResult>();
    const newest = new Map<string, Step>();
    for (const s of steps) {
      if (!('tool' in s) || s.isError) continue;
      const r = (s.result ?? {}) as any;
      if (s.tool === 'list_shops') for (const shop of Array.isArray(r) ? r : (r.result ?? [])) if (shop?.shop) shops.set(shop.shop, shop.name);
      if (s.tool === 'search_products') {
        for (const g of r.results ?? [{ shop: r.shop?.slug, name: r.shop?.name, products: r.products }]) {
          if (g.shop && g.name) shops.set(g.shop, g.name);
          for (const p of g.products ?? []) for (const v of p.variants ?? []) if (p.image) images.set(v.variant_id, p.image);
        }
      }
      const cart = r as CartResult;
      if (!cart.cart_id) continue;
      if (s.tool === 'create_cart' && cart.shop) cartShop.set(cart.cart_id, cart.shop);
      if (s.tool === 'get_cart') latest.set(cart.cart_id, cart);
      if (CART_TOOLS.includes(s.tool)) newest.set(cart.cart_id, s);
    }
    return { shops, images, cartShop, latest, newest };
  }, [steps]);

  /** Paid in this browser, or the shop says it's an order now (paid through the PayPal link instead). */
  function paidFor(cartId: string): PaidCart | undefined {
    const told = known.latest.get(cartId);
    return paid[cartId] ?? (told?.status === 'COMPLETED' ? { order: told.order?.number } : undefined);
  }

  function purchaseOf(cart: CartResult, done?: PaidCart): Purchase {
    const told = cart.cart_id ? known.latest.get(cart.cart_id) : undefined;
    const slug = cart.cart_id ? known.cartShop.get(cart.cart_id) : undefined;
    const tracking = typeof told?.order?.tracking === 'object' ? `Shipped with ${told.order.tracking.carrier} · ${told.order.tracking.number}.` : '';
    const refunded = told?.order?.refunded && told.order.refunded !== 'nothing' ? `Refunded ${told.order.refunded}.` : '';
    return {
      shop: slug ? (known.shops.get(slug) ?? undefined) : undefined,
      order: done?.order ?? told?.order?.number,
      lines: (cart.items ?? []).map((i) => ({
        ...splitName(i.name ?? i.variant_id ?? 'Item'),
        qty: i.quantity,
        amount: i.price ? formatMoney(toMinor(i.price) * i.quantity, i.price.currency_code) : undefined,
        image: i.variant_id ? known.images.get(i.variant_id) : undefined,
      })),
      subtotal: show(cart.totals?.subtotal),
      shipping: show(cart.totals?.shipping),
      tax: show(cart.totals?.tax),
      total: show(done?.total ?? cart.totals?.total),
      status: done ? [told?.order?.payment ?? paymentWords(done.status), tracking, refunded].filter(Boolean).join(' ') : 'Priced by the shop, with shipping and tax.',
      ...(done?.at ? { paidAt: done.at } : {}),
      ...(done && cart.cart_id ? { cartId: cart.cart_id } : {}),
    };
  }

  // Only the newest priced cart gets the button: an older one may have been changed since.
  const latestOrder = steps.map(payableCart).filter(Boolean).at(-1)?.orderId;
  /** After PayPal: keep the cart as paid and let the assistant confirm the order with the shop, out of sight. */
  function onPaid(cartId: string) {
    if (!onPaidFor.current.has(cartId)) {
      onPaidFor.current.set(cartId, (p: Paid) => {
        setPaid((all) => ({ ...all, [cartId]: { ...p, at: new Date().toISOString() } }));
        void send("I've approved the payment in PayPal.", true);
      });
    }
    return onPaidFor.current.get(cartId)!;
  }
  /** A cart step as a purchase: its receipt once paid, or the PayPal button if it's the cart to pay now. */
  function purchaseFor(step: Step, key: number) {
    if (!('tool' in step) || step.isError || !CART_TOOLS.includes(step.tool)) return null;
    const cart = (step.result ?? {}) as CartResult;
    if (!cart.cart_id || known.newest.get(cart.cart_id) !== step) return null;
    const done = paidFor(cart.cart_id);
    if (done) return <PurchaseCard key={key} state="paid" data={purchaseOf(cart, done)} />;
    const payable = payableCart(step);
    if (!payable || payable.orderId !== latestOrder) return null;
    const id = cart.cart_id;
    if (cancelled.includes(id)) {
      return (
        <div key={key} className="purchase-cancelled small">
          <span>
            <b>Cancelled.</b> Nothing was charged.
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setCancelled((c) => c.filter((x) => x !== id));
              setUntold((u) => u.filter((x) => x !== id));
            }}
          >
            Undo
          </button>
        </div>
      );
    }
    return (
      <PurchaseCard
        key={key}
        state="ready"
        data={purchaseOf(cart)}
        onCancel={() => {
          setCancelled((c) => [...c, id]);
          setUntold((u) => [...u, id]);
        }}
      >
        {paypalClientId ? (
          <PayPalCheckout clientId={paypalClientId} {...payable} onPaid={onPaid(payable.cartId)} />
        ) : (
          <a className="btn btn-primary" href={payable.approvalUrl} target="_blank" rel="noopener noreferrer">
            Pay with PayPal
          </a>
        )}
      </PurchaseCard>
    );
  }

  // Paid in another tab through the PayPal link? Ask the shop about the cart waiting to be paid, when the
  // chat opens and when the person comes back to this tab, so it never offers to pay twice.
  const waiting = steps.map(payableCart).filter(Boolean).at(-1);
  const waitingShop = waiting ? known.cartShop.get(waiting.cartId) : undefined;
  useEffect(() => {
    if (!waiting || !waitingShop || paid[waiting.cartId]) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const now = await callApi<CartResult>(`/api/shops/${waitingShop}/merchant-cart/${waiting.cartId}`, 'GET');
        if (now.status !== 'COMPLETED') return;
        const confirmed = now.payment_confirmation;
        setPaid((all) => ({ ...all, [waiting.cartId]: { order: confirmed?.merchant_order_number, status: confirmed?.payment_status, total: now.totals?.total, at: new Date().toISOString() } }));
      } catch {
        // can't tell right now: the button stays, and PayPal won't take the same order twice
      }
    };
    void check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [waiting?.cartId, waitingShop, paid]);

  return (
    <div className={compact ? 'shopper shopper-compact' : 'shopper'}>
      <div className="shopper-log" aria-live="polite" ref={log}>
        {turns.length === 0 && (
          <div className="shopper-empty">
            <b>Ask for something to buy.</b>
            <span className="small soft">The assistant searches every Sayso shop, builds a cart the shop prices, and you pay with PayPal&apos;s button right here. It&apos;s the PayPal sandbox: nothing real moves.</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn btn-small" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => {
          // A turn the page sent after paying: its receipt is the cart above. Show the assistant's words
          // only if something went wrong confirming it.
          if (t.hidden && !t.steps.some((s) => 'tool' in s && s.isError)) return null;
          return (
          <div key={i} className="stack" style={{ gap: 'var(--s2)' }}>
            {!t.hidden && <div className="shopper-user">{t.user}</div>}
            {t.steps.map((s, k) =>
              'tool' in s ? (
                <div key={k} className="stack" style={{ gap: 'var(--s2)' }}>
                  <div className={`shopper-tool${s.isError ? ' shopper-tool-warn' : ''}`}>
                    <span aria-hidden="true">{s.isError ? '!' : '✓'}</span> Sayso <code>{s.tool}</code> <span className="muted">{summary(s.tool, s.result, s.isError)}</span>
                  </div>
                  {foundProducts(s).length > 0 && <ProductCards items={foundProducts(s)} />}
                </div>
              ) : (
                <div key={k} className="shopper-bot">
                  {s.text.split(/\n+/).map((line, j) => (
                    <p key={j}>
                      <Rich text={line.replace(/^\s*[-*]\s+/, '• ')} />
                    </p>
                  ))}
                </div>
              ),
            )}
            {t.steps.map(purchaseFor)}
          </div>
          );
        })}
        {busy && <div className="shopper-tool shopper-thinking">{busy === 'confirming' ? 'Confirming your order with the shop…' : "Using Sayso's tools…"}</div>}
      </div>
      {error && <p className="error">{error}</p>}
      {turns.length > 0 && (
        <p className="small muted shopper-note">
          Kept in this browser. Your orders are also in <a href="/orders">My orders</a>, from any browser with PayPal.{' '}
          <button type="button" className="link-button" onClick={startOver} disabled={!!busy}>
            Start over
          </button>
        </p>
      )}
      <form
        className="shopper-box"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input className="shopper-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder="What are you looking for?" aria-label="Message the shopping assistant" disabled={!!busy} />
        <button className="btn btn-primary" disabled={!!busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
