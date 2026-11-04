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
import { demoCatalog } from '@/core/demo-shop.ts';
import { actionTitle } from '@/core/guard/describe.ts';
import { verifyAuditChain } from '@/core/guard/engine.ts';
import { DEFAULT_LIMITS } from '@/core/guard/policy.ts';
import type { GuardRecord } from '@/core/guard/types.ts';
import { formatMoney, majorUnits } from '@/core/money.ts';
import { tourProgress, type StepView } from '@/core/tour-progress.ts';
import { TOUR_ASKED_REFUND_LIMIT, TOUR_STEPS, type TourStep } from '@/core/tour.ts';
import { developerPortalBuilt, ready } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'For Judges: the 2-minute tour' };

/** Amounts in the copy, from the rules every tour copy starts with (the demo shop's currency). */
const money = (units: number) => formatMoney(majorUnits(units, demoCatalog.shop.currency), demoCatalog.shop.currency).replace(/\.00$/, '');

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
    proves: `The shop owner's own AI agent runs the shop, refunds included. But the owner's rules decide what it may do alone: refunds over ${money(DEFAULT_LIMITS.refundApproval)} wait for the owner.`,
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
    proves: `An agent can never raise its own limits. It asks to refund up to ${money(TOUR_ASKED_REFUND_LIMIT)} on its own; any rule change from an agent waits for the owner.`,
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

  const [steps, passkey] = await Promise.all([tourProgress(view, tour), view.passkeys.required(view.shopId)]);
  const asked = (await searchParams).step;
  const firstOpen = steps.findIndex((s) => s.state !== 'done' && s.state !== 'unavailable');
  const askedStep = Number(asked);
  const index = asked === 'end' ? steps.length : Number.isInteger(askedStep) && askedStep >= 1 && askedStep <= steps.length ? askedStep - 1 : firstOpen === -1 ? steps.length : firstOpen;
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
        <StepScreen view={current} n={index + 1} total={steps.length} redact={view.redact} passkey={passkey} />
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
        <p className="small">
          Rather be the shopper? <a href="/assistant">Buy from a shop with the AI assistant</a>, or connect your own assistant to Sayso&apos;s MCP server.
        </p>
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

function StepScreen({ view, n, total, redact, passkey }: { view: StepView; n: number; total: number; redact: (text: string) => string; passkey: boolean }) {
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
                        <b>{actionTitle(r.action)}</b>
                        <span className="small soft">{r.decision?.hits.map((h) => h.message).join(' ')}</span>
                      </span>
                      <Decision id={r.id} passkey={passkey} />
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
                  <AdoptRule id={view.suggestion.id} passkey={passkey} />
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
            <a href="/owner/phone">
              <b>Take it to your phone</b>
              <span className="small soft">Scan a QR code, install Sayso, get pinged and approve the next request with your fingerprint or face. The signature lands in the audit.</span>
            </a>
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
