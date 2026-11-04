'use client';

// The shopping assistant: the person types what they want, the assistant uses Sayso's buyer tools (the
// same ones any assistant gets over MCP) and each tool call shows as it happened. No account: PayPal
// knows the buyer when they pay, and the conversation (with its cart and order) is kept in this browser,
// so they can come back after paying and ask where the order is or for a refund. The server checks and
// caps the conversation on every turn.

import { useEffect, useRef, useState } from 'react';
import { callApi } from './api.ts';

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
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className={pay ? 'btn btn-paypal btn-small shopper-pay' : undefined}>
              {link[1]}
            </a>
          );
        }
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        return bold ? <b key={i}>{bold[1]}</b> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function ShopperChat() {
  const [history, setHistory] = useState<unknown[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  // Pick the conversation back up (after paying in PayPal, or a reload); storage may be unavailable.
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

  return (
    <div className="shopper">
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
                <div key={k} className={`shopper-tool${s.isError ? ' shopper-tool-warn' : ''}`}>
                  <span aria-hidden="true">{s.isError ? '!' : '✓'}</span> Sayso <code>{s.tool}</code> <span className="muted">{summary(s.tool, s.result, s.isError)}</span>
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
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder="What are you looking for?" aria-label="Message the shopping assistant" disabled={busy} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
