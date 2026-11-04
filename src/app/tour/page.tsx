// For Judges: try Sayso for real, as a buyer or as a seller, on the PayPal sandbox. Each path is a short
// checklist that ticks itself off from what this browser has done. Buying: the assistant finds something,
// PayPal's button pays, the order page follows it, the assistant asks for a refund, and the shop's side
// shows it all. Selling: a shop from photos, published with PayPal, then the scripted agents on that very
// shop (a shopper's assistant buys, the shop's agent asks for a refund and tries to loosen its rules) while
// Guard holds what only the judge may decide.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Decision, FlashNotice } from '@/app/_components/owner-actions.tsx';
import { OpenDemoShop, RunStep } from '@/app/_components/tour-actions.tsx';
import { Icon, Status } from '@/app/_components/ui.tsx';
import { buyerOrder, type BuyerOrder } from '@/core/buyer-orders.ts';
import { isLive } from '@/core/catalog.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { actionTitle } from '@/core/guard/describe.ts';
import { DEFAULT_LIMITS } from '@/core/guard/policy.ts';
import type { GuardRecord } from '@/core/guard/types.ts';
import { formatMoney, majorUnits } from '@/core/money.ts';
import { tourProgress, type StepView } from '@/core/tour-progress.ts';
import type { TourStep } from '@/core/tour.ts';
import { paidHere } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';
import { claimedShop } from '@/server/seller-session.ts';

export const metadata: Metadata = { title: 'For Judges', description: 'Try Sayso for real on the PayPal sandbox: buy with the AI assistant, or open a shop and run it with your agent.' };

type State = 'done' | 'now' | 'open' | 'later';
interface Row {
  title: string;
  note: string;
  state: State;
  action?: React.ReactNode;
  /** For the agents' steps: what happened, what to decide, what Guard recorded. */
  detail?: React.ReactNode;
}

const limit = formatMoney(majorUnits(DEFAULT_LIMITS.refundApproval, demoCatalog.shop.currency), demoCatalog.shop.currency).replace(/\.00$/, '');

const AGENT_STEP: Record<TourStep, { title: string; note: string; run: string } | undefined> = {
  buy: { title: "A shopper's assistant buys from you", note: 'It pays with saved PayPal; Guard checks the stock and captures.', run: 'Let it buy' },
  refund: { title: 'Your agent asks for a refund', note: `Over your ${limit} rule, so it waits for you.`, run: 'Let your agent ask' },
  rules: { title: 'Your agent tries to raise its own limit', note: 'Only you can change your rules.', run: 'Let your agent try' },
  commission: undefined,
  earn: undefined,
};

export default async function JudgesPage({ searchParams }: { searchParams: Promise<{ published?: string }> }) {
  await connection();
  const published = (await searchParams).published === '1';
  const { carts, catalogs, orders, links, tours } = await ready();

  // The buyer's side: the orders this browser paid for, newest first.
  const deps = { carts, catalogs, orders, links };
  const paid = (await Promise.all((await paidHere()).map((id) => buyerOrder(deps, id)))).filter((o): o is BuyerOrder => Boolean(o));
  const order = paid.sort((a, b) => b.placedAt.localeCompare(a.placedAt))[0];

  // The seller's side: the shop this browser is signed in to, if a judge opened it; else a draft in progress.
  const view = await ownerView();
  const tour = view ? await tours?.forShop(view.shopId) : undefined;
  const mine = tour?.kind === 'seller' && view ? { view, tour } : undefined;
  const draftId = mine ? undefined : await claimedShop();
  const drafting = draftId && (await tours?.forShop(draftId))?.kind === 'seller' ? await catalogs.byShopId(draftId) : undefined;
  const steps = mine ? await tourProgress(mine.view, mine.tour) : [];
  const passkey = mine ? await mine.view.passkeys.required(mine.view.shopId) : false;

  const buying: Row[] = [
    {
      title: 'Buy with the assistant',
      note: "Ask in your own words, then pay with PayPal's button.",
      state: order ? 'done' : 'now',
      action: !order && (
        <a className="btn btn-primary btn-small" href={`/assistant?ask=${encodeURIComponent('Buy me a handmade mug from Maya Ceramics, under $50.')}`}>
          Open the assistant
        </a>
      ),
    },
    {
      title: 'Follow your order',
      note: 'Where it is, tracking and refunds, on any device.',
      state: order ? 'open' : 'later',
      action: order && (
        <a className="btn btn-small" href={`/order/${order.id}`}>
          Open your order
        </a>
      ),
    },
    {
      title: 'Ask for a refund',
      note: 'The assistant takes your reason to the shop; the owner decides.',
      state: !order ? 'later' : order.refundRequests.length > 0 ? 'done' : 'now',
      action: order && order.refundRequests.length === 0 && order.canAskRefund && (
        <a className="btn btn-small" href={`/assistant?ask=${encodeURIComponent(`I'd like a refund for order ${order.number}.`)}`}>
          Ask the assistant
        </a>
      ),
    },
    {
      title: "See it from the shop's side",
      note: 'Your order and your request, on the shop owner’s dashboard.',
      state: order ? 'open' : 'later',
      action: order && order.shop.url?.endsWith(`/shop/${demoCatalog.shop.slug}`) && <OpenDemoShop />,
    },
  ];

  const live = Boolean(mine && isLive(mine.view.catalog));
  // A refund needs an order: it waits until the shopper's assistant has paid.
  const bought = steps.find((s) => s.step === 'buy')?.state === 'done';
  const selling: Row[] = [
    {
      title: 'Open a shop from photos',
      note: 'Sayso drafts each listing; you check every price.',
      state: mine || drafting ? 'done' : 'now',
      action: !mine && !drafting && (
        <a className="btn btn-primary btn-small" href="/start?judge=1">
          Start selling
        </a>
      ),
    },
    {
      title: 'Publish with PayPal',
      note: 'Sign in with the sandbox business account.',
      state: live ? 'done' : mine || drafting ? 'now' : 'later',
      action: drafting && (
        <a className="btn btn-primary btn-small" href="/start?judge=1">
          Review and publish
        </a>
      ),
    },
    ...steps.flatMap((s): Row[] => {
      const info = AGENT_STEP[s.step];
      if (!info) return [];
      const waiting = s.step === 'refund' && !bought;
      const state: State = !live || waiting || s.state === 'unavailable' ? 'later' : s.state === 'done' ? 'done' : 'now';
      return [
        {
          title: info.title,
          note: s.state === 'unavailable' ? (s.why ?? info.note) : info.note,
          state,
          action: live && !waiting && s.state === 'next' && <RunStep step={s.step} label={info.run} screen="/tour#sell" />,
          detail: live && s.result ? <AgentDetail view={s} passkey={passkey} redact={mine!.view.redact} /> : undefined,
        },
      ];
    }),
    ...(!mine
      ? (['buy', 'refund', 'rules'] as const).map((step): Row => ({ title: AGENT_STEP[step]!.title, note: AGENT_STEP[step]!.note, state: 'later' }))
      : []),
  ];

  return (
    <main className="wrap page judges">
      <header className="judges-head">
        <span className="small soft">For Judges</span>
        <h1>Try Sayso for real</h1>
        <p className="lede">Buy like a shopper, or open a shop and run it with your own agent. Everything runs on the PayPal sandbox; no real money moves.</p>
        <p className="judges-need small">
          <Icon name="shield" size={16} />
          <span>
            You&apos;ll need the PayPal sandbox accounts from the testing instructions: a <b>personal</b> account to pay, a <b>business</b> account to
            sell.
          </span>
        </p>
        {published && (
          <FlashNotice params={['published']} className="callout small callout-say">
            Your shop is live. Now let the agents at it, below.
          </FlashNotice>
        )}
      </header>

      <div className="judges-paths">
        <Path id="buy" title="Buy something" time="About 3 minutes" icon="bag" rows={buying} />
        <Path
          id="sell"
          title="Open a shop and run it"
          time="About 5 minutes"
          icon="agent"
          rows={selling}
          foot={
            mine && (
              <span className="small">
                <a href="/owner">Open your dashboard</a> · Your shop closes after two days.
              </span>
            )
          }
        />
      </div>
    </main>
  );
}

function Path({ id, title, time, icon, rows, foot }: { id: string; title: string; time: string; icon: string; rows: Row[]; foot?: React.ReactNode }) {
  const done = rows.filter((r) => r.state === 'done').length;
  return (
    <section id={id} className="judges-path" aria-labelledby={`${id}-title`}>
      <header className="judges-path-head">
        <span className="judges-path-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <h2 id={`${id}-title`}>{title}</h2>
          <span className="small soft">
            {time} · {done} of {rows.length} done
          </span>
        </span>
      </header>
      <ol className="judges-steps">
        {rows.map((r, i) => (
          <li key={r.title} className={`judges-step judges-step-${r.state}`}>
            <span className="judges-dot" aria-hidden="true">
              {r.state === 'done' ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div className="judges-step-body">
              <b>{r.title}</b>
              <span className="small soft">{r.note}</span>
              {r.action && <div className="judges-action">{r.action}</div>}
              {r.detail}
            </div>
          </li>
        ))}
      </ol>
      {foot && <footer className="judges-path-foot">{foot}</footer>}
    </section>
  );
}

/** What an agent step did: the outcome, the say-so the judge gives right here, and Guard's record. */
function AgentDetail({ view, passkey, redact }: { view: StepView; passkey: boolean; redact: (text: string) => string }) {
  return (
    <div className="judges-detail">
      {view.outcome && <p className={`tour-outcome tour-outcome-${view.state}`}>{redact(view.outcome)}</p>}
      {view.payUrl && (
        <a className="btn btn-primary btn-small" href={view.payUrl}>
          Pay in PayPal sandbox
        </a>
      )}
      {view.decide.length > 0 && (
        <ul className="tour-decide">
          {view.decide.map((r) => (
            <li key={r.id}>
              <span className="stack" style={{ gap: 0 }}>
                <b>{actionTitle(r.action)}</b>
                <span className="small soft">{r.decision?.hits.map((h) => h.message).join(' ')}</span>
              </span>
              <Decision id={r.id} passkey={passkey} />
            </li>
          ))}
        </ul>
      )}
      {view.result && (
        <details className="tour-details">
          <summary>What the agents did, and what Guard checked</summary>
          <ol className="tour-log">
            {view.result.transcript.map((line, i) => (
              <li key={i}>
                <span className="who who-agent">
                  <Icon name="agent" size={14} />
                  {line.who === 'assistant' ? "Shopper's assistant" : 'Your agent'}
                </span>
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <code>{line.did}</code>
                  <span className="small">{redact(line.said)}</span>
                </span>
              </li>
            ))}
          </ol>
          {view.records.map((r) => (
            <Trace key={r.id} record={r} />
          ))}
        </details>
      )}
    </div>
  );
}

const STAGE: Record<string, string> = {
  proposed: 'Proposed',
  simulated: 'Simulated before acting',
  decided: 'Checked against the rules',
  approved: 'You said OK',
  rejected: 'You said no',
  executed: 'Sent to PayPal',
  verified: 'Read back from PayPal',
  unverified: 'Sent, not yet confirmed',
  failed: 'Failed',
};

/** One Guard record as the stages it went through, each with its audit-chain hash. */
function Trace({ record }: { record: GuardRecord }) {
  return (
    <div className="panel panel-tight stack" style={{ gap: 'var(--s2)' }}>
      <div className="spread">
        <span className="small">
          {actionTitle(record.action)} · Guard record <span className="mono">{record.id}</span>
        </span>
        <Status value={record.status} />
      </div>
      <ol className="small soft" style={{ margin: 0, paddingLeft: '1.2em' }}>
        {record.events.map((e) => (
          <li key={e.hash}>
            {STAGE[e.type] ?? e.type} <span className="mono muted">{e.hash.slice(0, 8)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
