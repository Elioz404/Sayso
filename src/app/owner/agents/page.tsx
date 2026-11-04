// The owner's own agents: who is connected (each with its own key), what each has asked for, what any
// agent may do here and what only the owner can, and where shoppers' assistants find the shop.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { ConnectAgent, RevokeKey } from '@/app/_components/owner-actions.tsx';
import { Ago, When } from '@/app/_components/time.tsx';
import type { AgentKey } from '@/core/access.ts';
import type { Policy } from '@/core/guard/policy.ts';
import type { ActionKind, GuardRecord } from '@/core/guard/types.ts';
import { formatMoney } from '@/core/money.ts';
import { SHARED_DEMO_READ_ONLY } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Agents' };

interface Asked {
  total: number;
  neededYou: number;
  waiting: number;
}

/** What each key's agent asked Guard for: refunds, invoices, rule changes. Its actor id ends with the key id. */
function askedByKey(records: readonly GuardRecord[]): Map<string, Asked> {
  const byKey = new Map<string, Asked>();
  for (const r of records) {
    const { actor } = r.action;
    if (actor.type !== 'agent' || !actor.id.startsWith('agent:')) continue;
    const keyId = actor.id.split(':').at(-1)!;
    const asked = byKey.get(keyId) ?? { total: 0, neededYou: 0, waiting: 0 };
    asked.total++;
    if (r.status === 'pending_approval') asked.waiting++;
    if (r.status === 'pending_approval' || r.events.some((e) => e.type === 'approved' || e.type === 'rejected')) asked.neededYou++;
    byKey.set(keyId, asked);
  }
  return byKey;
}

/** "$50.00": above this, `kind` waits for the owner. */
function approvalLimit(policy: Policy, kind: ActionKind): string | undefined {
  const rule = policy.rules.find((r) => r.type === 'max_amount' && r.kinds.includes(kind) && r.then === 'require_approval');
  return rule?.type === 'max_amount' ? formatMoney(rule.limit, policy.currency) : undefined;
}

export default async function Agents() {
  const view = await ownerView();
  if (!view) return null;
  const { access, saySo, shopId, shop, links, demo } = view;
  const [keys, records, policy] = await Promise.all([access.listKeys(shopId), saySo.audit(shopId, 500), saySo.policy(shopId)]);
  const live = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const asked = askedByKey(records);
  const refundLimit = approvalLimit(policy, 'refund.create');
  const invoiceLimit = approvalLimit(policy, 'invoice.send');
  const limits = [refundLimit && `refunds up to ${refundLimit}`, invoiceLimit && `invoices up to ${invoiceLimit}`].filter(Boolean).join(' and ');

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Agents</h1>
          <p className="sub">Your own AI runs this shop with Sayso&apos;s tools. Money only moves within your rules or with your OK.</p>
        </div>
        {!demo && live.length > 0 && <ConnectAgent endpoint={links.sellerMcp} />}
      </div>

      <div className="agents-grid">
        <section className="panel agents-panel" aria-labelledby="connected">
          <div className="panel-card-head">
            <h2 id="connected" className="h3">
              Connected agents
            </h2>
            <span className="small muted">{live.length ? `${live.length} active` : ''}</span>
          </div>
          {live.length ? (
            <ul className="agent-list">
              {live.map((k) => (
                <AgentRow key={k.id} agent={k} asked={asked.get(k.id)} action={!k.shared && !demo && <RevokeKey id={k.id} label={k.label} />} />
              ))}
            </ul>
          ) : (
            <div className="agents-empty">
              <b>No agent connected yet</b>
              <span className="small soft">Connect ChatGPT or any MCP app, and it can look after orders, stock and refunds for you.</span>
              {!demo && <ConnectAgent endpoint={links.sellerMcp} quiet />}
            </div>
          )}
          {demo && <p className="small soft">{SHARED_DEMO_READ_ONLY}</p>}
          {revoked.length > 0 && (
            <details className="agents-revoked">
              <summary className="small">Revoked ({revoked.length})</summary>
              <ul className="agent-list">
                {revoked.map((k) => (
                  <AgentRow key={k.id} agent={k} asked={asked.get(k.id)} />
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="panel agents-panel" aria-labelledby="can">
          <h2 id="can" className="h3">
            What an agent can do
          </h2>
          <ul className="agent-can">
            <li>
              <span>
                <b>On its own</b>
                <span className="small soft">Orders and sales, prices and stock, what to make next, tracking numbers.</span>
              </span>
            </li>
            <li>
              <span>
                <b>Within your rules</b>
                <span className="small soft">
                  {limits ? `${limits.charAt(0).toUpperCase()}${limits.slice(1)} on its own.` : 'Refunds and invoices, as far as your rules allow.'} Past
                  that, it waits for your OK.
                </span>
              </span>
            </li>
            <li>
              <span>
                <b>Only you</b>
                <span className="small soft">Saying OK, changing the rules (an agent can only propose), publishing, keys.</span>
              </span>
            </li>
          </ul>
          <a className="small" href="/owner/rules">
            Your rules →
          </a>
        </section>
      </div>

      <section className="block" aria-labelledby="shoppers">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="shoppers">Where shoppers&apos; AI finds you</h2>
          <p className="soft small">Buyers&apos; assistants need no key: they browse, fill a cart and hand the buyer a PayPal link.</p>
        </div>
        <div className="panel agents-links">
          <div className="field">
            <span className="field-label">Your shop</span>
            <CopyField value={links.shopMcp(shop.slug)} />
          </div>
          <div className="field">
            <span className="field-label">Every Sayso shop, yours included</span>
            <CopyField value={links.shoppingMcp} />
          </div>
        </div>
      </section>
    </>
  );
}

function AgentRow({ agent: k, asked, action }: { agent: AgentKey; asked?: Asked; action?: ReactNode }) {
  return (
    <li className={`agent-row${k.revokedAt ? ' agent-row-off' : ''}`}>
      <span className="agent-name">
        <b>{k.label}</b>
        <span className="small muted">
          <span className="mono">sk_agent_…{k.hint}</span> · {k.revokedAt ? <>revoked <When iso={k.revokedAt} /></> : <>added <When iso={k.createdAt} /></>}
        </span>
      </span>
      <span className="agent-use small">
        <span>
          {k.lastUsedAt ? (
            <>
              Used <Ago iso={k.lastUsedAt} />
            </>
          ) : (
            'Not used yet'
          )}
        </span>
        <span className="muted">
          {asked ? `${asked.total} request${asked.total === 1 ? '' : 's'}${asked.neededYou ? ` · ${asked.neededYou} needed your OK` : ''}` : 'No requests yet'}
        </span>
        {asked?.waiting ? (
          <a className="agent-waiting" href="/owner#waiting">
            {asked.waiting} waiting for you
          </a>
        ) : null}
      </span>
      {k.shared ? <span className="small muted agent-end">Shared demo key</span> : action && <span className="agent-end">{action}</span>}
    </li>
  );
}
