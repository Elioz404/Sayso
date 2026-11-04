// The shop's rules, read per action (refunds, invoices, charges, rule changes): what an agent does on its
// own, what waits for the owner's OK, what is blocked. Then how to change them, and the rules the owner's
// own decisions have earned.
import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { AdoptRule } from '@/app/_components/owner-actions.tsx';
import { APPROVALS_NEEDED } from '@/core/guard/autonomy.ts';
import { rulesByAction } from '@/core/guard/rules-by-action.ts';
import { ACTIONS } from '@/core/guard/types.ts';
import { ownerView, pendingFor } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Rules' };

const EXAMPLE = 'Refunds over $30 need my OK. Invoices to new clients always need my OK.';

/** A rule change in one line: the agent's words as asked ('New rules: "..."'), or an earned rule's title. */
function proposal(reason: string): string {
  if (reason.startsWith('New rules: ')) return reason.slice('New rules: '.length);
  const first = reason.split('. ')[0];
  return first.endsWith('.') ? first : `${first}.`;
}

export default async function Rules() {
  const view = await ownerView();
  if (!view) return null;
  const { saySo, shopId, demo, access } = view;
  const [policy, { suggestions, learning }, passkey, pending, keys] = await Promise.all([
    saySo.policy(shopId),
    saySo.autonomy(shopId),
    view.passkeys.required(shopId),
    pendingFor(shopId),
    access.listKeys(shopId),
  ]);
  const rows = rulesByAction(policy);
  const proposed = pending.filter((r) => r.action.kind === 'policy.update');
  const watching = learning.filter((l) => l.approvals < l.needed);
  const agents = keys.some((k) => !k.revokedAt);
  // An earned rule the agent already sent: it is answered there, not adopted twice.
  const waitingFor = (title: string) => proposed.find((r) => r.action.reason.startsWith(title));

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Rules</h1>
          <p className="sub">Sayso checks every request from an agent against these before anything reaches PayPal.</p>
        </div>
      </div>

      {proposed.map((r) => (
        <div className="callout" key={r.id}>
          <span className="small">
            <b>New rules are waiting for your OK.</b> {proposal(r.action.reason)}
          </span>
          <a className="btn btn-small" href={`/approve/${r.id}`}>
            Review
          </a>
        </div>
      ))}

      <div className="rules-grid">
        <section className="panel rules-panel" aria-labelledby="current">
          <h2 id="current" className="h3">
            What your agents may do
          </h2>
          <div className="rules-table" role="table" aria-label="Your rules, per action">
            <div className="rules-tr rules-th" role="row">
              <span role="columnheader">Action</span>
              <span role="columnheader">On its own</span>
              <span role="columnheader">Needs your OK</span>
              <span role="columnheader">Blocked</span>
            </div>
            {rows.map((r) => (
              <div className="rules-tr" role="row" key={r.kind}>
                <b role="rowheader">{r.label}</b>
                <span role="cell" data-label="On its own">
                  {r.alone}
                </span>
                <span role="cell" data-label="Needs your OK" className="rules-ask">
                  {r.ask.length ? r.ask.map((c) => <span key={c}>{c}</span>) : <span className="muted">Nothing</span>}
                </span>
                <span role="cell" data-label="Blocked" className="rules-block">
                  {r.block.length ? r.block.map((c) => <span key={c}>{c}</span>) : <span className="muted">Nothing</span>}
                </span>
              </div>
            ))}
          </div>
          {policy.source && (
            <p className="small soft rules-source">
              {policy.source.startsWith('Default:') ? 'The rules every new shop starts with.' : <>In your words: &ldquo;{policy.source}&rdquo;</>}
            </p>
          )}
        </section>

        <section className="panel rules-panel" aria-labelledby="change">
          <h2 id="change" className="h3">
            Change them
          </h2>
          {demo ? (
            <p className="small soft">The shared demo keeps its rules, so everyone sees the same shop. Open your own shop from For Judges to change yours.</p>
          ) : (
            <>
              <p className="small soft">Tell your agent in plain words. It drafts the new rules and sends them to you: nothing changes until you say OK.</p>
              <div className="field">
                <span className="field-label">For example</span>
                <CopyField value={EXAMPLE} />
              </div>
              {agents ? (
                <details className="rules-more">
                  <summary className="small">From a terminal</summary>
                  <CopyField value={`sayso policy propose "${EXAMPLE}"`} />
                </details>
              ) : (
                <p className="small">
                  No agent yet? <a href="/owner/agents">Connect one</a>.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section className="block" aria-labelledby="earned">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="earned">Earned from your decisions</h2>
          <p className="soft small">
            After you approve the same kind of request {APPROVALS_NEEDED} times, Sayso suggests letting your agent do those alone, never
            past anything you turned down.
          </p>
        </div>
        {suggestions.map((s) => (
          <div className="panel earned" key={s.id}>
            <div className="stack" style={{ gap: 6, minWidth: 0 }}>
              <b>{s.title}</b>
              <p className="small soft">{s.evidence}</p>
            </div>
            {demo ? (
              <p className="small muted">The shared demo keeps its rules.</p>
            ) : waitingFor(s.title) ? (
              <a className="btn" href={`/approve/${waitingFor(s.title)!.id}`}>
                Review your agent&apos;s request
              </a>
            ) : (
              <AdoptRule id={s.id} passkey={passkey} />
            )}
          </div>
        ))}
        {watching.length > 0 && (
          <div className="panel">
            <ul className="learning">
              {watching.map((l) => (
                <li key={`${l.ruleId}-${l.kind}`}>
                  <b className="small">{ACTIONS[l.kind].noun.charAt(0).toUpperCase() + ACTIONS[l.kind].noun.slice(1)}</b>
                  <span className="learning-meter" role="img" aria-label={`${l.approvals} of ${l.needed} approvals`}>
                    {Array.from({ length: l.needed }, (_, i) => (
                      <i key={i} className={i < l.approvals ? 'on' : undefined} />
                    ))}
                  </span>
                  <span className="small soft">
                    {l.approvals} of {l.needed} approvals{l.rejections ? `, ${l.rejections} turned down` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!suggestions.length && !watching.length && <p className="small muted">None of your rules ask for your OK, so there is nothing to learn from yet.</p>}
      </section>
    </>
  );
}
