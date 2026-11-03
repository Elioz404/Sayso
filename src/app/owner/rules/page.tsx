import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { describeRule } from '@/core/guard/policy-store.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Rules' };

export default async function Rules() {
  const view = await ownerView();
  if (!view) return null;
  const { seller, shopId, shop } = view;
  const policy = await seller.policy(shopId);

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
                  <span>{describeRule(r, shop.currency)}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {policy.source && <p className="small soft">Written from: &ldquo;{policy.source}&rdquo;</p>}
      </section>

      <section className="block" aria-labelledby="change">
        <h2 id="change">Change the rules</h2>
        <p className="soft">
          Tell your agent in plain words. It drafts the rules and sends them to you; nothing changes until you say OK, so an agent can
          never loosen its own limits.
        </p>
        <CopyField value={'sayso policy propose "Refunds over $30 need my OK. Never accept a dispute without asking me."'} />
      </section>
    </>
  );
}
