import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { AdoptRule } from '@/app/_components/owner-actions.tsx';
import { ACTIONS } from '@/core/guard/types.ts';
import { describeRule } from '@/core/guard/policy-store.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Rules' };

export default async function Rules() {
  const view = await ownerView();
  if (!view) return null;
  const { saySo, shopId, demo } = view;
  const [policy, { suggestions, learning }, passkey] = await Promise.all([saySo.policy(shopId), saySo.autonomy(shopId), view.passkeys.required(shopId)]);
  const watching = learning.filter((l) => l.approvals < l.needed);

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Rules</h1>
          <p className="sub">What your agents may do on their own, what needs your OK, and what is never allowed.</p>
        </div>
      </div>

      <section className="block" aria-labelledby="current">
        <h2 id="current" className="sr-only">
          Current rules
        </h2>
        <div className="panel">
          <ul className="rules">
            {policy.rules.map((r) => {
              const blocks = r.type === 'never' || r.type === 'no_duplicates' || ('then' in r && r.then === 'deny');
              return (
                <li key={r.id}>
                  <span className={`rule-kind ${blocks ? 'rule-block' : 'rule-ask'}`}>{blocks ? 'Block' : 'Ask me'}</span>
                  <span>{describeRule(r, policy.currency)}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {policy.source && <p className="small soft">Written from: &ldquo;{policy.source}&rdquo;</p>}
      </section>

      <section className="block" aria-labelledby="earned">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="earned">Earned from your decisions</h2>
          <p className="soft">
            When you keep approving the same kind of request, Sayso suggests letting your agent handle those alone, never past anything you
            turned down. An agent can ask for one too, but only you can say yes.
          </p>
        </div>
        {suggestions.map((s) => (
          <div className="panel earned" key={s.id}>
            <div className="stack" style={{ gap: 6, minWidth: 0 }}>
              <b>{s.title}</b>
              <p className="small soft">{s.evidence}</p>
            </div>
            {demo ? <p className="small muted">The shared demo keeps its rules. Your tour copy can take this.</p> : <AdoptRule id={s.id} passkey={passkey} />}
          </div>
        ))}
        {watching.length > 0 && (
          <ul className="learning">
            {watching.map((l) => (
              <li key={`${l.ruleId}-${l.kind}`}>
                <span className="learning-meter" aria-hidden="true">
                  {Array.from({ length: l.needed }, (_, i) => (
                    <i key={i} className={i < l.approvals ? 'on' : undefined} />
                  ))}
                </span>
                <span className="small">
                  {ACTIONS[l.kind].label}: you approved {l.approvals} of the {l.needed} Sayso needs to see before it suggests anything
                  {l.rejections ? ` (and turned down ${l.rejections})` : ''}.
                </span>
              </li>
            ))}
          </ul>
        )}
        {!suggestions.length && !watching.length && <p className="small muted">None of your rules ask for your OK, so there is nothing to learn yet.</p>}
      </section>

      <section className="block" aria-labelledby="change">
        <h2 id="change">Change the rules</h2>
        <p className="soft">
          Tell your agent in plain words. It drafts the rules and sends them to you; nothing changes until you say OK, so an agent can
          never loosen its own limits.
        </p>
        <CopyField value={'sayso policy propose "Refunds over $30 need my OK. Invoices to new clients always need my OK."'} />
      </section>
    </>
  );
}
