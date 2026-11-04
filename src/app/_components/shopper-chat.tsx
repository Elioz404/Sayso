'use client';

// The shopping assistant: the person types what they want, the assistant uses Sayso's buyer tools (the
// same ones any assistant gets over MCP) and each tool call shows as it happened. No account: PayPal
// knows the buyer when they pay, and the conversation (with its cart and order) is kept in this browser,
// so they can come back after paying and ask where the order is or for a refund. The server checks and
// caps the conversation on every turn.

import { useEffect, useRef, useState } from 'react';
import { callApi } from './api.ts';
import { PayPalCheckout, type Paid } from './paypal-checkout.tsx';

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
type Turn = { user: string; steps: Step[] };

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

/** `request`: a message sent from elsewhere on the page ("Buy with AI"); it continues the conversation. */
export function ShopperChat({ paypalClientId, request, compact = false }: { paypalClientId?: string; request?: { text: string; id: number }; compact?: boolean }) {
  const [history, setHistory] = useState<unknown[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  const [paid, setPaid] = useState<Record<string, Paid>>({});
  const onPaidFor = useRef(new Map<string, (p: Paid) => void>());
  // Pick the conversation back up (after paying in PayPal, a reload, another page); storage may be off.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as { history: unknown[]; turns: Turn[] } | null;
      if (saved?.turns?.length) {
        setHistory(saved.history);
        setTurns(saved.turns);
      }
    } catch {
      // nothing saved, or storage is off: start fresh
    }
  }, []);
  useEffect(() => {
    if (request) void send(request.text);
    // A new request is a new id; `send` is this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  function remember(nextHistory: unknown[], nextTurns: Turn[]) {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ history: nextHistory, turns: nextTurns }));
    } catch {
      // full or off: the conversation still works in this tab
    }
  }
  function startOver() {
    setHistory([]);
    setTurns([]);
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

  async function send(message: string) {
    const said = message.trim();
    if (!said || busy) return;
    setBusy(true);
    setError(undefined);
    setText('');
    setTurns((t) => [...t, { user: said, steps: [] }]);
    try {
      const reply = await callApi<{ messages: unknown[]; steps: Step[] }>('/api/shopper', 'POST', { messages: history, text: said });
      const nextTurns = [...turns, { user: said, steps: reply.steps }];
      setHistory(reply.messages);
      setTurns(nextTurns);
      remember(reply.messages, nextTurns);
    } catch (err) {
      setError((err as Error).message);
      setTurns((t) => t.slice(0, -1));
      setText(said);
    } finally {
      setBusy(false);
    }
  }

  // Only the newest priced cart gets the button: an older one may have been changed since.
  const latestOrder = turns.flatMap((t) => t.steps).map(payableCart).filter(Boolean).at(-1)?.orderId;
  /** After PayPal: mark the cart paid and let the assistant confirm the order with the shop. */
  function onPaid(cartId: string) {
    if (!onPaidFor.current.has(cartId)) {
      onPaidFor.current.set(cartId, (p: Paid) => {
        setPaid((all) => ({ ...all, [cartId]: p }));
        void send("I've approved the payment in PayPal.");
      });
    }
    return onPaidFor.current.get(cartId)!;
  }
  function checkoutFor(step: Step) {
    const cart = payableCart(step);
    if (!cart || cart.orderId !== latestOrder) return null;
    const done = paid[cart.cartId];
    if (done) return <div className="shopper-paid">✓ Paid with PayPal{done.order ? ` · order ${done.order}` : ''}</div>;
    return paypalClientId ? <PayPalCheckout clientId={paypalClientId} {...cart} onPaid={onPaid(cart.cartId)} /> : null;
  }

  return (
    <div className={compact ? 'shopper shopper-compact' : 'shopper'}>
      <div className="shopper-log" aria-live="polite" ref={log}>
        {turns.length === 0 && (
          <div className="shopper-empty">
            <b>Ask for something to buy.</b>
            <span className="small soft">The assistant searches every Sayso shop, builds a cart the shop prices, and hands you a PayPal link. You pay in the PayPal sandbox; nothing real moves.</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn btn-small" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="stack" style={{ gap: 'var(--s2)' }}>
            <div className="shopper-user">{t.user}</div>
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
            {t.steps.map(checkoutFor).find(Boolean)}
          </div>
        ))}
        {busy && <div className="shopper-tool shopper-thinking">Using Sayso's tools…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      {turns.length > 0 && (
        <p className="small muted shopper-note">
          Kept in this browser, so you can come back after paying to track the order or ask for a refund.{' '}
          <button type="button" className="link-button" onClick={startOver} disabled={busy}>
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
        <input className="shopper-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder="What are you looking for?" aria-label="Message the shopping assistant" disabled={busy} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
