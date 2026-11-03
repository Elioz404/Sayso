// For Judges: the 2-minute tour. A private copy of the demo shop, two scripted agents using the same
// tools any assistant uses, and the judge as the owner who gives (or refuses) every say-so. One step is
// open at a time; what happened stays one click away, and decisions are made right here.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { Decision } from '@/app/_components/owner-actions.tsx';
import { RunStep, StartTour } from '@/app/_components/tour-actions.tsx';
import { When } from '@/app/_components/time.tsx';
import { Icon, Status } from '@/app/_components/ui.tsx';
import type { GuardRecord } from '@/core/guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney } from '@/core/money.ts';
import { TOUR_STEPS, type StepResult, type Tour, type TourStep } from '@/core/tour.ts';
import { developerPortalBuilt, ready } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'For Judges: the 2-minute tour' };

type OwnerView = NonNullable<Awaited<ReturnType<typeof ownerView>>>;

const STEP: Record<TourStep, { title: string; proves: string; run: string }> = {
  buy: {
    title: 'A shopping assistant buys from the shop',
    proves: "It asks for two mugs when one is left, applies the fix the shop offers (PayPal's merchant-cart spec) and pays with the buyer's saved PayPal, inside their limits.",
    run: 'Let the assistant shop',
  },
  refund: {
    title: 'Your agent asks for a big refund',
    proves: 'This shop’s rules say refunds over $50 need the owner. That’s you.',
    run: 'Ask for the refund',
  },
  rules: {
    title: 'Your agent tries to loosen its own rules',
    proves: 'It asks to refund up to $10,000 on its own. No rule can allow that.',
    run: 'Let it try',
  },
  commission: {
    title: 'Your agent invoices a commission',
    proves: 'A PayPal invoice with a deposit, for someone who has never paid this shop.',
    run: 'Send the invoice',
  },
};

/** next: the step to run now. later: after that. blocked: can't run yet. needs-you: waits on the judge. */
type State = 'next' | 'later' | 'blocked' | 'needs-you' | 'done';

interface StepView {
  step: TourStep;
  state: State;
  /** The result in one line, read before anything else. */
  outcome?: string;
  why?: string;
  result?: StepResult;
  records: GuardRecord[];
  /** The say-so request the judge can decide right here. */
  decide?: GuardRecord;
  payUrl?: string;
}

const WHO = { assistant: "Buyer's assistant", 'owner-agent': 'Your agent' } as const;

export default async function TourPage() {
  await connection();
  const view = await ownerView();
  const tour = view && (await view.tours?.forShop(view.shopId));
  const { links, tours } = await ready();
  const steps = view && tour ? await stepViews(view, tour) : [];
  const done = steps.filter((s) => s.state === 'done').length;

  return (
    <main className="wrap page stack" style={{ gap: 'var(--s6)' }}>
      <div className="stack" style={{ gap: 'var(--s2)', maxWidth: '68ch' }}>
        <span className="status status-ok" style={{ alignSelf: 'flex-start' }}>
          For Judges
        </span>
        <h1>The 2-minute tour</h1>
        <p className="lede">
          Your own private copy of Maya Ceramics, two AI agents, and you as the owner. Every payment is a real PayPal sandbox call, and nothing moves
          past the shop&apos;s rules without your say-so.
        </p>
      </div>

      {!tours ? (
        <div className="empty">
          <b>The tour isn&apos;t running on this server.</b>
          <span className="small">It is part of the hosted demo.</span>
        </div>
      ) : !tour ? (
        <section className="panel stack" style={{ gap: 'var(--s5)', maxWidth: '68ch' }}>
          <ol className="steps">
            {TOUR_STEPS.map((s) => (
              <li key={s}>
                <span className="stack" style={{ gap: 2 }}>
                  <b>{STEP[s].title}</b>
                  <span className="small soft">{STEP[s].proves}</span>
                </span>
              </li>
            ))}
          </ol>
          <StartTour />
          <p className="small muted">No sign-in and nothing to install. Your copy, its orders and its rules are yours alone and disappear after a day.</p>
        </section>
      ) : (
        <div className="split split-start">
          <div className="stack" style={{ gap: 'var(--s4)', minWidth: 0 }}>
            <div className="tour-progress" aria-label={`${done} of ${steps.length} steps done`}>
              <span className="small soft">
                {done} of {steps.length} done
              </span>
              <span className="tour-bar">
                <span style={{ width: `${(done / steps.length) * 100}%` }} />
              </span>
            </div>
            <ol className="tour-steps">
              {steps.map((s, i) => (
                <StepCard key={s.step} view={s} n={i + 1} redact={view!.redact} />
              ))}
            </ol>
            {done === steps.length && <Finale mcpUrl={links.shopMcp(tour.slug)} />}
          </div>

          <aside className="panel stack" style={{ gap: 'var(--s4)', position: 'sticky', top: 'var(--s4)' }}>
            <h2 style={{ margin: 0 }}>Your private shop</h2>
            <p className="small soft">
              You are its owner until <When iso={tour.expiresAt} />. Everything there is real.
            </p>
            <ul className="list">
              {[
                ['/owner', 'Overview: what waits for you'],
                ['/owner/catalog', 'Catalog: edit prices and stock in the grid'],
                ['/owner/production', 'Making: work gated by PayPal payments'],
                ['/owner/activity', 'Activity: the hash-chained audit log'],
                ...(developerPortalBuilt() ? [[links.developers, 'Developer portal: API, SDKs, try-it']] : []),
              ].map(([href, label]) => (
                <li key={href}>
                  <a className="list-link" href={href}>
                    {label} <Icon name="arrow" size={15} />
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </main>
  );
}

/** Where each step stands, from the tour's results and the live Guard records and order. */
async function stepViews(view: OwnerView, tour: Tour): Promise<StepView[]> {
  const record = async (result?: StepResult) => (result?.recordId ? await view.guard.get(result.recordId) : undefined);
  const buy = tour.steps.buy;
  const order = buy?.cartId ? (await view.orders.get(view.shopId, buy.cartId)).order : undefined;
  const paid = order?.status === 'paid';

  const views: StepView[] = [];
  for (const step of TOUR_STEPS) {
    const result = tour.steps[step];
    if (step === 'buy') {
      const captures = buy?.cartId ? await view.guard.list(view.shopId, { cartId: buy.cartId, kind: 'payment.capture' }) : [];
      views.push(
        !result
          ? { step, state: 'next', records: [] }
          : paid
            ? { step, state: 'done', result, records: captures, outcome: `Paid ${order!.total}. The shop's Guard checked the stock and captured it in PayPal.` }
            : { step, state: 'needs-you', result, records: captures, outcome: 'The cart is ready. Pay for it in PayPal sandbox to place the order.', payUrl: result.approvalUrl },
      );
      continue;
    }
    if (!result) {
      // Blocked only once the purchase ran and still isn't paid; before that the refund is just up next.
      const blocked = step === 'refund' && Boolean(buy) && !paid;
      views.push({ step, state: blocked ? 'blocked' : 'next', records: [], why: blocked ? 'Step 1 has to be paid first: there is nothing to refund yet.' : undefined });
      continue;
    }
    const r = await record(result);
    views.push({ step, state: r?.status === 'pending_approval' ? 'needs-you' : 'done', result, records: r ? [r] : [], decide: r?.status === 'pending_approval' ? r : undefined, outcome: r && outcome(step, r) });
  }
  // Only the first runnable step offers its button; the rest wait their turn.
  let next = false;
  for (const v of views) {
    if (v.state !== 'next') continue;
    if (next) v.state = 'later';
    next = true;
  }
  return views;
}

/** The step's result in one line. */
function outcome(step: TourStep, r: GuardRecord): string {
  const amount = r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? DEFAULT_CURRENCY) : '';
  const lines: Partial<Record<TourStep, Partial<Record<GuardRecord['status'], string>>>> = {
    refund: {
      pending_approval: `Guard held a ${amount} refund. Nothing moves until you decide.`,
      verified: `You said OK. PayPal refunded ${amount}, and Sayso read it back to confirm.`,
      rejected: 'You said no. Nothing moved.',
    },
    rules: {
      pending_approval: "Guard held it: an agent can't change its own rules. Only you can.",
      verified: 'You approved the new rules. (A careful owner would say no.)',
      rejected: 'You said no. The rules stay as they are.',
    },
    commission: {
      pending_approval: `Waiting for you: a ${amount} invoice to someone who has never paid this shop.`,
      verified: 'Sent in PayPal. It is on your Making board, blocked until the buyer pays.',
      rejected: 'You said no. No invoice went out.',
    },
  };
  return lines[step]?.[r.status] ?? `Guard: ${r.status.replace(/_/g, ' ')}. ${r.verification?.detail ?? ''}`.trim();
}

function StepCard({ view, n, redact }: { view: StepView; n: number; redact: (text: string) => string }) {
  const { step, state } = view;
  if (state === 'later') {
    return (
      <li className="tour-step tour-step-later">
        <span className="tour-num">{n}</span>
        <span className="soft">{STEP[step].title}</span>
      </li>
    );
  }
  return (
    <li className={`tour-step tour-step-${state}`}>
      <span className="tour-num">{state === 'done' ? <Icon name="check" size={14} /> : n}</span>
      <div className="stack" style={{ gap: 'var(--s3)', minWidth: 0 }}>
        <b>{STEP[step].title}</b>
        {view.outcome ? <p className="tour-outcome">{redact(view.outcome)}</p> : <p className="small soft">{STEP[step].proves}</p>}

        {state === 'next' && <RunStep step={step} label={STEP[step].run} />}
        {state === 'blocked' && (
          <div className="stack" style={{ gap: 'var(--s2)', alignItems: 'flex-start' }}>
            <button className="btn" disabled>
              {STEP[step].run}
            </button>
            <span className="small muted">{view.why}</span>
          </div>
        )}
        {view.decide && <Decision id={view.decide.id} />}
        {view.payUrl && (
          <p className="small">
            <a className="btn btn-primary btn-small" href={view.payUrl}>
              Pay in PayPal sandbox
            </a>{' '}
            <span className="muted">with the test buyer from the testing instructions, then come back.</span>
          </p>
        )}

        {view.result && (
          <details className="tour-details">
            <summary>What the agents did, and what Guard checked</summary>
            <ol className="tour-log">
              {view.result.transcript.map((line, i) => (
                <li key={i}>
                  <span className="who who-agent">
                    <Icon name="agent" size={14} />
                    {WHO[line.who]}
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
    </li>
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
          Guard record <span className="mono">{record.id}</span>
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

function Finale({ mcpUrl }: { mcpUrl: string }) {
  return (
    <section className="panel panel-raised stack" style={{ gap: 'var(--s4)' }}>
      <h2 style={{ margin: 0 }}>That&apos;s Sayso</h2>
      <ul className="stack" style={{ gap: 'var(--s2)', margin: 0, paddingLeft: '1.2em' }}>
        <li>Any shopping assistant can buy from a small shop through PayPal, and fix problems on its own.</li>
        <li>The owner&apos;s own agent runs the shop, but every money move goes through Guard: simulated, checked, verified and logged.</li>
        <li>Anything past the owner&apos;s rules waits for their say-so, including the agent&apos;s own rules.</li>
      </ul>
      <div className="field">
        <span className="field-label">Try your copy in your own assistant (MCP)</span>
        <CopyField value={mcpUrl} />
        <span className="hint">Add it as a connector in ChatGPT or any MCP client and ask it to buy something.</span>
      </div>
    </section>
  );
}
