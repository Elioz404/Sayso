// For Judges: the 2-minute tour. A private copy of the demo shop, two scripted agents using the same
// tools any assistant uses, and the judge as the owner who gives (or refuses) every say-so.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { RunStep, StartTour } from '@/app/_components/tour-actions.tsx';
import { When } from '@/app/_components/time.tsx';
import { Icon, Status } from '@/app/_components/ui.tsx';
import type { Guard } from '@/core/guard/engine.ts';
import type { GuardRecord } from '@/core/guard/types.ts';
import type { StepResult, TourStep } from '@/core/tour.ts';
import { developerPortalBuilt, ready } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'For Judges: the 2-minute tour' };

const STEPS: { step: TourStep; title: string; proves: string; run: string }[] = [
  {
    step: 'buy',
    title: 'A shopping assistant buys from the shop',
    proves:
      "It asks for two mugs when only one is left, applies the fix the shop offers (PayPal's merchant-cart spec), and pays with the buyer's saved PayPal inside their limits. The shop's Guard checks stock and captures.",
    run: 'Let the assistant shop',
  },
  {
    step: 'refund',
    title: 'Your agent asks for a big refund',
    proves: 'Refunds over $50 need your OK under this shop’s rules, so Guard holds it. You decide; PayPal refunds and Sayso reads it back to confirm.',
    run: 'Ask for the refund',
  },
  {
    step: 'rules',
    title: 'Your agent tries to loosen its own rules',
    proves: 'It asks to refund up to $10,000 on its own. No rule can allow that: changing the rules always waits for the owner.',
    run: 'Let it try',
  },
  {
    step: 'commission',
    title: 'Your agent invoices a commission',
    proves: 'A PayPal invoice with a deposit for someone who has never paid you, so it waits for you. Once sent it lands on the Making board, blocked until the buyer pays.',
    run: 'Send the invoice',
  },
];

const WHO = { assistant: "Buyer's assistant", 'owner-agent': 'Your agent' } as const;

export default async function Tour() {
  await connection();
  const view = await ownerView();
  const tour = view && (await view.tours?.forShop(view.shopId));
  const { links, tours } = await ready();

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
            {STEPS.map((s) => (
              <li key={s.step}>
                <span className="stack" style={{ gap: 2 }}>
                  <b>{s.title}</b>
                  <span className="small soft">{s.proves}</span>
                </span>
              </li>
            ))}
          </ol>
          <StartTour />
          <p className="small muted">No sign-in and nothing to install. Your copy, its orders and its rules are yours alone and disappear after a day.</p>
        </section>
      ) : (
        <div className="split split-start">
          <ol className="list" style={{ gap: 'var(--s4)' }}>
            {await Promise.all(
              STEPS.map(async (s, i) => {
                const result = tour.steps[s.step];
                const records = result ? await stepRecords(view!.guard, view!.shopId, s.step, result) : [];
                return (
                  <li key={s.step} className="panel stack" style={{ gap: 'var(--s3)' }}>
                    <span className="small muted">Step {i + 1}</span>
                    <h2 style={{ margin: 0 }}>{s.title}</h2>
                    <p className="small soft">{s.proves}</p>
                    {!result ? (
                      <RunStep step={s.step} label={s.run} />
                    ) : (
                      <>
                        <ol className="tour-log">
                          {result.transcript.map((line, n) => (
                            <li key={n}>
                              <span className="who who-agent">
                                <Icon name="agent" size={14} />
                                {WHO[line.who]}
                              </span>
                              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                                <code>{line.did}</code>
                                <span className="small">{view!.redact(line.said)}</span>
                              </span>
                            </li>
                          ))}
                        </ol>
                        {result.approvalUrl && (
                          <p className="small">
                            Pay in PayPal sandbox with the test buyer from the testing instructions: <a href={result.approvalUrl}>approve the payment</a>, then run the next step.
                          </p>
                        )}
                        {records.map((r) => (
                          <Trace key={r.id} record={r} />
                        ))}
                      </>
                    )}
                  </li>
                );
              }),
            )}
          </ol>

          <aside className="panel stack" style={{ gap: 'var(--s4)', position: 'sticky', top: 'var(--s4)' }}>
            <h2 style={{ margin: 0 }}>Your private shop</h2>
            <p className="small soft">
              You are signed in as its owner until it expires, <When iso={tour.expiresAt} />. Everything you see there is real.
            </p>
            <ul className="list">
              {[
                ['/owner', 'Overview: what waits for you'],
                ['/owner/orders', 'Orders'],
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
            <div className="field">
              <span className="field-label">Try it in your own assistant (MCP)</span>
              <CopyField value={links.shopMcp(tour.slug)} />
              <span className="hint">Add it as a connector in ChatGPT or any MCP client and ask it to buy something from this shop.</span>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

/** The say-so requests a step made: the one it waits on, or (for the purchase) the shop's capture. */
async function stepRecords(guard: Guard, shopId: string, step: TourStep, result: StepResult): Promise<GuardRecord[]> {
  if (step === 'buy') return result.cartId ? guard.list(shopId, { cartId: result.cartId, kind: 'payment.capture' }) : [];
  const record = result.recordId ? await guard.get(result.recordId) : undefined;
  return record ? [record] : [];
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

/** One Guard record as the steps it went through, with the next move when it waits for the judge. */
function Trace({ record }: { record: GuardRecord }) {
  const waiting = record.status === 'pending_approval';
  return (
    <div className={`panel panel-tight stack ${waiting ? 'panel-hold' : ''}`} style={{ gap: 'var(--s2)' }}>
      <div className="spread">
        <span className="small">
          Guard <span className="mono">{record.id}</span>
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
      {waiting && (
        <a className="btn btn-primary btn-small" href={`/approve/${record.id}`} style={{ alignSelf: 'flex-start' }}>
          Decide as the owner
        </a>
      )}
    </div>
  );
}
