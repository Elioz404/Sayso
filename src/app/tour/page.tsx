// For Judges: the 2-minute tour. A private copy of the demo shop, two scripted agents using the same
// tools any assistant uses, and the judge as the owner who gives (or refuses) every say-so. One step per
// screen: what it proves, what the judge does, what happened (with the agents' transcript and the Guard
// record behind it), then the next step. Everything is real: PayPal sandbox calls, Guard, the audit log.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { AdoptRule, Decision } from '@/app/_components/owner-actions.tsx';
import { RunStep, StartTour } from '@/app/_components/tour-actions.tsx';
import { When } from '@/app/_components/time.tsx';
import { Icon, Status } from '@/app/_components/ui.tsx';
import { verifyAuditChain } from '@/core/guard/engine.ts';
import type { GuardRecord } from '@/core/guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney } from '@/core/money.ts';
import { TOUR_STEPS, type StepResult, type Tour, type TourStep } from '@/core/tour.ts';
import { developerPortalBuilt, ready } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'For Judges: the 2-minute tour' };

type OwnerView = NonNullable<Awaited<ReturnType<typeof ownerView>>>;

const STEP: Record<TourStep, { short: string; title: string; proves: string; you: string; run: string; uses: string[] }> = {
  buy: {
    short: 'An assistant buys',
    title: 'A shopping assistant buys from the shop',
    proves:
      "AI shoppers can buy from a small shop safely. The shop prices the cart, not the AI (PayPal's merchant-cart spec). The assistant hits a stock limit and fixes it with the shop's own suggestion, then pays with the buyer's saved PayPal, inside limits the buyer set.",
    you: 'Watch: the assistant does it all.',
    run: 'Let the assistant shop',
    uses: ['PayPal merchant-cart API', 'Orders v2', 'Saved PayPal (Vault)', 'Guard'],
  },
  refund: {
    short: 'A big refund',
    title: 'Your agent asks for a big refund',
    proves: "The shop owner's own AI agent runs the shop, refunds included. But the owner's rules decide what it may do alone: refunds over $50 wait for the owner.",
    you: "You are the owner. Say OK and PayPal refunds it; reject and nothing moves.",
    run: 'Let the agent ask',
    uses: ['Guard', 'Payments v2 refunds'],
  },
  commission: {
    short: 'A commission',
    title: 'Your agent invoices a commission',
    proves: 'Made-to-order work is invoiced through PayPal with a deposit. A first invoice to someone who has never paid the shop waits for the owner.',
    you: 'Decide whether the invoice goes out.',
    run: 'Let the agent invoice',
    uses: ['Invoicing v2', 'Guard'],
  },
  rules: {
    short: 'Grabbing autonomy',
    title: 'Your agent tries to loosen its own rules',
    proves: 'An agent can never raise its own limits. It asks to refund up to $10,000 on its own; any rule change from an agent waits for the owner.',
    you: 'Decide. (A careful owner says no.)',
    run: 'Let the agent try',
    uses: ['Guard: rules only the owner can change'],
  },
  earn: {
    short: 'Earning autonomy',
    title: 'Your agent earns autonomy',
    proves:
      'When the owner keeps approving the same kind of request, Sayso suggests letting the agent handle those alone: up to what was approved, never past anything turned down. Autonomy is earned, never grabbed.',
    you: 'The agent asks for three small refunds on a new order. Approve them, then adopt the rule they earned.',
    run: 'Let the agent ask',
    uses: ['Earned autonomy', 'Guard', 'Payments v2 refunds'],
  },
};

/** next: run it now. needs-you: waits on the judge. done: finished. unavailable: can't run here. */
type State = 'next' | 'needs-you' | 'done' | 'unavailable';

interface StepView {
  step: TourStep;
  state: State;
  /** The result in one line. */
  outcome?: string;
  why?: string;
  result?: StepResult;
  records: GuardRecord[];
  /** Say-so requests the judge can decide right here. */
  decide: GuardRecord[];
  payUrl?: string;
  /** The rule the judge's approvals earned ("earn"). */
  suggestion?: { id: string; title: string; evidence: string };
}

const WHO = { assistant: "Buyer's assistant", 'owner-agent': 'Your agent' } as const;

export default async function TourPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  await connection();
  const view = await ownerView();
  const tour = view && (await view.tours?.forShop(view.shopId));
  const { links, tours } = await ready();

  if (!tours) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>The 2-minute tour</h1>
        <div className="empty">
          <b>The tour isn&apos;t running on this server.</b>
          <span className="small">It is part of the hosted demo.</span>
        </div>
      </main>
    );
  }
  if (!view || !tour) return <Intro />;

  const steps = await stepViews(view, tour);
  const asked = (await searchParams).step;
  const firstOpen = steps.findIndex((s) => s.state !== 'done' && s.state !== 'unavailable');
  const index = asked === 'end' ? steps.length : asked && /^[1-5]$/.test(asked) ? Number(asked) - 1 : firstOpen === -1 ? steps.length : firstOpen;
  const current = steps[index];

  return (
    <main className="wrap page stack tour" style={{ gap: 'var(--s5)' }}>
      <div className="tour-head">
        <div className="stack" style={{ gap: 2 }}>
          <span className="small soft">For Judges</span>
          <h1 className="tour-title">The 2-minute tour</h1>
        </div>
        <span className="small soft">
          Your private copy of Maya Ceramics, until <When iso={tour.expiresAt} />
        </span>
      </div>

      <nav aria-label="Tour steps">
        <ol className="tour-nav">
          {steps.map((s, i) => (
            <li key={s.step} className={`tour-nav-${i === index ? 'here' : s.state}`}>
              <a href={`?step=${i + 1}`} aria-current={i === index ? 'step' : undefined}>
                <span className="tour-dot">{s.state === 'done' ? <Icon name="check" size={13} /> : i + 1}</span>
                <span className="tour-nav-label">{STEP[s.step].short}</span>
              </a>
            </li>
          ))}
          <li className={`tour-nav-${index === steps.length ? 'here' : 'later'}`}>
            <a href="?step=end" aria-current={index === steps.length ? 'step' : undefined}>
              <span className="tour-dot">
                <Icon name="arrow" size={13} />
              </span>
              <span className="tour-nav-label">Wrap-up</span>
            </a>
          </li>
        </ol>
      </nav>

      {current ? (
        <StepScreen view={current} n={index + 1} total={steps.length} redact={view.redact} />
      ) : (
        <WrapUp steps={steps} mcpUrl={links.shopMcp(tour.slug)} portal={developerPortalBuilt() ? links.developers : undefined} />
      )}

      <p className="small muted tour-foot">
        Your shop is yours to explore at any point:{' '}
        <a href="/owner">Overview</a> · <a href="/owner/catalog">Catalog</a> · <a href="/owner/production">Making</a> · <a href="/owner/rules">Rules</a> ·{' '}
        <a href="/owner/activity">Audit log</a>
      </p>
    </main>
  );
}

function Intro() {
  return (
    <main className="wrap page tour-intro">
      <div className="stack" style={{ gap: 'var(--s5)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <span className="small soft">For Judges</span>
          <h1>The 2-minute tour</h1>
          <p className="lede">
            You get your own copy of a small shop, Maya Ceramics, and become its owner. Two AI agents act in it: a shopper&apos;s assistant and
            the owner&apos;s own agent. Every payment is a real PayPal sandbox call, and nothing moves past the shop&apos;s rules without your
            say-so.
          </p>
        </div>
        <StartTour />
        <p className="small muted">No sign-in, nothing to install. Five short steps, one per screen. Your copy disappears after a day.</p>
      </div>
      <ol className="tour-outline">
        {TOUR_STEPS.map((s, i) => (
          <li key={s}>
            <span className="tour-dot">{i + 1}</span>
            <span className="stack" style={{ gap: 2 }}>
              <b>{STEP[s].title}</b>
              <span className="small soft">{STEP[s].uses.join(' · ')}</span>
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function StepScreen({ view, n, total, redact }: { view: StepView; n: number; total: number; redact: (text: string) => string }) {
  const { step, state } = view;
  const info = STEP[step];
  const nextHref = n === total ? '?step=end' : `?step=${n + 1}`;
  return (
    <section className={`tour-screen tour-screen-${state}`} aria-labelledby="step-title">
      <div className="tour-screen-main stack" style={{ gap: 'var(--s5)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <span className="small soft">
            Step {n} of {total}
          </span>
          <h2 id="step-title" className="tour-step-title">
            {info.title}
          </h2>
        </div>

        <div className="tour-proves">
          <b className="small">What this proves</b>
          <p>{info.proves}</p>
          <span className="tour-uses small">{info.uses.join(' · ')}</span>
        </div>

        <div className="stack" style={{ gap: 'var(--s3)' }}>
          <b className="small">Your part</b>
          {state === 'unavailable' ? (
            <p className="soft">{view.why}</p>
          ) : (
            <>
              {state === 'next' && <p className="soft">{info.you}</p>}
              {state === 'next' && <RunStep step={step} label={info.run} screen={`/tour?step=${n}`} />}
              {view.outcome && <p className={`tour-outcome tour-outcome-${state}`}>{redact(view.outcome)}</p>}
              {view.decide.length > 0 && (
                <ul className="tour-decide">
                  {view.decide.map((r) => (
                    <li key={r.id}>
                      <span className="stack" style={{ gap: 0 }}>
                        <b>{describe(r)}</b>
                        <span className="small soft">{r.decision?.hits.map((h) => h.message).join(' ')}</span>
                      </span>
                      <Decision id={r.id} />
                    </li>
                  ))}
                </ul>
              )}
              {view.suggestion && (
                <div className="tour-earned">
                  <span className="stack" style={{ gap: 4 }}>
                    <b>{view.suggestion.title}</b>
                    <span className="small soft">{view.suggestion.evidence}</span>
                  </span>
                  <AdoptRule id={view.suggestion.id} />
                </div>
              )}
              {view.payUrl && (
                <p className="small">
                  <a className="btn btn-primary btn-small" href={view.payUrl}>
                    Pay in PayPal sandbox
                  </a>{' '}
                  <span className="muted">with the sandbox buyer from the testing instructions, then come back.</span>
                </p>
              )}
            </>
          )}
        </div>

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

      <div className="tour-screen-nav">
        {n > 1 ? (
          <a className="btn btn-quiet" href={`?step=${n - 1}`}>
            <Icon name="back" size={16} /> Back
          </a>
        ) : (
          <span />
        )}
        <a className={state === 'done' || state === 'unavailable' ? 'btn btn-primary' : 'btn'} href={nextHref}>
          {n === total ? 'Wrap-up' : state === 'done' || state === 'unavailable' ? 'Next step' : 'Skip for now'} <Icon name="arrow" size={16} />
        </a>
      </div>
    </section>
  );
}

/** Where each step stands, from the tour's results and the live Guard records, order and rules. */
async function stepViews(view: OwnerView, tour: Tour): Promise<StepView[]> {
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
          ? { step, state: 'next', records: [], decide: [] }
          : paid
            ? { step, state: 'done', result, records: captures, decide: [], outcome: `Paid ${order!.total}. Guard checked the stock and captured it in PayPal.` }
            : { step, state: 'needs-you', result, records: captures, decide: [], outcome: 'The cart is ready. Pay for it in PayPal sandbox to place the order.', payUrl: result.approvalUrl },
      );
      continue;
    }
    if (step === 'earn') {
      views.push(await earnView(view, tour, result));
      continue;
    }
    if (!result) {
      const blocked = step === 'refund' && Boolean(buy) && !paid;
      views.push({ step, state: blocked ? 'unavailable' : 'next', records: [], decide: [], why: blocked ? 'Step 1 has to be paid first: there is nothing to refund yet.' : undefined });
      continue;
    }
    const r = result.recordId ? await view.guard.get(result.recordId) : undefined;
    const pending = r?.status === 'pending_approval';
    views.push({ step, state: pending ? 'needs-you' : 'done', result, records: r ? [r] : [], decide: pending ? [r] : [], outcome: r && outcome(step, r) });
  }
  return views;
}

async function earnView(view: OwnerView, tour: Tour, result: StepResult | undefined): Promise<StepView> {
  const step = 'earn';
  if (!tour.walletId) return { step, state: 'unavailable', records: [], decide: [], why: 'This step pays for its own order with saved PayPal, and this server has none to lend.' };
  if (!result) return { step, state: 'next', records: [], decide: [] };

  const records = (await Promise.all((result.recordIds ?? []).map((id) => view.guard.get(id)))).filter((r): r is GuardRecord => Boolean(r));
  const pending = records.filter((r) => r.status === 'pending_approval');
  if (pending.length) {
    const decided = records.length - pending.length;
    return { step, state: 'needs-you', result, records, decide: pending, outcome: `Guard held ${records.length} refunds over your $50 rule. ${decided} decided, ${pending.length} to go.` };
  }
  if (records.some((r) => r.events.some((e) => e.type === 'rejected'))) {
    return { step, state: 'done', result, records, decide: [], outcome: 'You turned at least one down, so Sayso suggests nothing: autonomy only grows from your yeses.' };
  }
  const [suggestion] = (await view.saySo.autonomy(view.shopId)).suggestions;
  if (suggestion) return { step, state: 'needs-you', result, records, decide: [], suggestion, outcome: 'You approved all three. Your approvals earned a rule:' };
  const adopted = (await view.guard.list(view.shopId, { kind: 'policy.update' })).find((r) => r.action.actor.type === 'human' && r.status === 'verified' && r.createdAt >= result.at);
  return adopted
    ? { step, state: 'done', result, records: [...records, adopted], decide: [], outcome: 'Adopted. Refunds like these now go through on their own; bigger ones still wait for you. See it in Rules.' }
    : { step, state: 'done', result, records, decide: [], outcome: 'Your agent already had room for these refunds, so none needed you.' };
}

function describe(r: GuardRecord): string {
  const amount = r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? DEFAULT_CURRENCY) : '';
  const what = { 'refund.create': 'Refund', 'invoice.send': 'Invoice', 'policy.update': 'New rules', 'payment.capture': 'Charge', 'payment.void': 'Release', 'checkout.create': 'Purchase' }[r.action.kind];
  return [what, amount].filter(Boolean).join(' ');
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
          {describe(record)} · Guard record <span className="mono">{record.id}</span>
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

/** The end: what the judge just did, the evidence behind it, and how to go further. */
function WrapUp({ steps, mcpUrl, portal }: { steps: StepView[]; mcpUrl: string; portal?: string }) {
  const records = steps.flatMap((s) => s.records);
  const intact = records.every((r) => verifyAuditChain(r));
  const ids = [...new Set(records.flatMap((r) => [r.result?.capture_id, r.result?.refund_id, r.result?.invoice_id]).filter((x): x is string => typeof x === 'string'))];
  return (
    <section className="tour-screen" aria-labelledby="wrap-title">
      <div className="tour-screen-main stack" style={{ gap: 'var(--s6)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h2 id="wrap-title" className="tour-step-title">
            That&apos;s Sayso
          </h2>
          <p className="lede">Small shops that AI shoppers can buy from, run by the owner&apos;s own agent, where money only moves with the owner&apos;s say-so.</p>
        </div>

        <ol className="tour-recap">
          {steps.map((s) => (
            <li key={s.step} className={`tour-recap-${s.state}`}>
              <span className="tour-dot">{s.state === 'done' ? <Icon name="check" size={13} /> : '·'}</span>
              <span className="stack" style={{ gap: 2 }}>
                <b>{STEP[s.step].title}</b>
                <span className="small soft">{s.outcome ?? (s.state === 'unavailable' ? s.why : 'Not run yet.')}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="tour-proves">
          <b className="small">The evidence</b>
          <p>
            {records.length} Guard record{records.length === 1 ? '' : 's'}, each with a hash chain that is {intact ? 'intact' : 'BROKEN'}.
            {ids.length > 0 && <> PayPal ids you can look up in the sandbox: </>}
          </p>
          {ids.length > 0 && <p className="mono small tour-ids">{ids.join('  ')}</p>}
        </div>

        <div className="stack" style={{ gap: 'var(--s4)' }}>
          <h3>Go deeper, with the sandbox accounts from the testing instructions</h3>
          <div className="tour-deeper">
            <a href="/start">
              <b>Open a shop from one photo</b>
              <span className="small soft">AI names and describes it; Channel3 suggests a price you confirm before publishing.</span>
            </a>
            <a href="/owner">
              <b>Sign in with PayPal and get paid directly</b>
              <span className="small soft">Claim the shop with a sandbox business account, then connect it: sales land in that account.</span>
            </a>
            <a href={portal ?? '/docs'}>
              <b>{portal ? 'Developer portal' : 'Docs'}</b>
              <span className="small soft">The shops API, typed SDKs and a try-it console, generated with APIMatic.</span>
            </a>
          </div>
          <div className="field">
            <span className="field-label">Or shop your copy from your own assistant (MCP)</span>
            <CopyField value={mcpUrl} />
          </div>
        </div>
      </div>
    </section>
  );
}
