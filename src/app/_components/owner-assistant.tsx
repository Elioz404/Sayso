'use client';

// The owner's assistant in their dashboard. The conversation stays in this tab, under this shop (another
// shop, or another owner signing in here, starts clean), as text only: what was asked and what it said.
// Answers are shown as plain text, never as HTML: buyers write some of what the assistant reads.

import { useEffect, useRef, useState } from 'react';
import { callApi } from './api.ts';

interface Line {
  role: 'user' | 'assistant';
  content: string;
  /** Which of the shop's records the answer came from. */
  used?: string[];
}

/** Where the conversations live; signing out clears every one of them. */
export const OWNER_CHAT_PREFIX = 'sayso-owner-chat-v1:';

const READ: Record<string, string> = {
  sales_summary: 'sales',
  shop_overview: 'overview',
  list_orders: 'orders',
  get_order: 'an order',
  list_products: 'catalog',
  production_board: 'making',
  list_invoices: 'invoices',
  list_approvals: 'requests',
  get_say_so: 'a request',
  get_policy: 'rules',
  rule_suggestions: 'earned rules',
  audit_log: 'activity',
};

const SUGGESTIONS = ['How are sales this month?', 'Refunds this month', 'Estimate for the whole month', 'What is waiting for me?', 'Top products, last 30 days', 'What should I make next?'];

/** Lines kept in the tab, and how many of the last ones go with each question (what the server reads). */
const KEEP = 40;
const SEND = 24;

/** `chat`: this shop and this kind of session (the shared demo and its owner never share a conversation). */
export function OwnerAssistant({ chat, compact = false }: { chat: string; compact?: boolean }) {
  const key = `${OWNER_CHAT_PREFIX}${chat}`;
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const log = useRef<HTMLDivElement>(null);
  // Nothing is saved until the saved conversation has been read (a first empty render must not erase it).
  const loaded = useRef(false);
  // The conversation an answer belongs to; one that comes back after a switch is dropped.
  const current = useRef(key);
  current.current = key;

  useEffect(() => {
    loaded.current = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]') as Line[];
      setLines(Array.isArray(saved) ? saved.filter((l) => (l.role === 'user' || l.role === 'assistant') && typeof l.content === 'string').slice(-KEEP) : []);
    } catch {
      setLines([]); // storage off: start clean
    }
    loaded.current = true;
  }, [key]);

  useEffect(() => {
    if (loaded.current) {
      try {
        if (lines.length) sessionStorage.setItem(key, JSON.stringify(lines.slice(-KEEP)));
        else sessionStorage.removeItem(key);
      } catch {
        // storage off: the conversation lasts as long as the page
      }
    }
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [lines, key]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const asked = key;
    const before = lines;
    setLines([...before, { role: 'user' as const, content: q }].slice(-KEEP));
    setText('');
    setBusy(true);
    setError(undefined);
    try {
      const out = await callApi<{ reply: string; used: string[] }>('/api/owner/assistant', 'POST', {
        messages: before.slice(-SEND).map(({ role, content }) => ({ role, content })),
        text: q,
      });
      if (current.current === asked) setLines((now) => [...now, { role: 'assistant' as const, content: out.reply, used: out.used }].slice(-KEEP));
    } catch (err) {
      if (current.current === asked) {
        setError((err as Error).message);
        setLines(before);
        setText(q);
      }
    }
    setBusy(false);
  }

  return (
    <div className={compact ? 'assistant assistant-compact' : 'assistant'}>
      <div className="assistant-log" ref={log} aria-live="polite">
        {lines.length === 0 ? (
          <div className="assistant-empty">
            <b>Ask about your shop</b>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="assistant-suggestion" onClick={() => void ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          lines.map((l, i) =>
            l.role === 'user' ? (
              <p key={i} className="assistant-me">
                {l.content}
              </p>
            ) : (
              <div key={i} className="assistant-bot">
                <p>{l.content}</p>
                {l.used && l.used.length > 0 && <span className="small muted">Read: {l.used.map((u) => READ[u] ?? u).join(', ')}</span>}
              </div>
            ),
          )
        )}
        {busy && <p className="assistant-bot small muted">Reading your shop…</p>}
      </div>
      {error && <p className="error small">{error}</p>}
      <form
        className="assistant-box"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="assistant-text" className="sr-only">
          Ask about your shop
        </label>
        <input id="assistant-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about sales, refunds, orders…" maxLength={800} autoComplete="off" />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
      {lines.length > 0 && !compact && (
        <button type="button" className="link-button small assistant-new" onClick={() => setLines([])} disabled={busy}>
          New chat
        </button>
      )}
    </div>
  );
}

/** Forget every owner conversation kept in this tab (on sign-out). */
export function forgetOwnerChats(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(OWNER_CHAT_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // storage off: nothing kept
  }
}
