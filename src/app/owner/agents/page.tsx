import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { NewKey, RevokeKey } from '@/app/_components/owner-actions.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { Ago } from '@/app/_components/time.tsx';
import { SHARED_DEMO_READ_ONLY } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Agents' };

export default async function Agents() {
  const view = await ownerView();
  if (!view) return null;
  const { access, shopId, shop, links, demo } = view;
  const keys = await access.listKeys(shopId);
  const live = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Agents</h1>
          <p className="sub">Each key lets one agent run this shop. No key can approve, publish or change your rules.</p>
        </div>
      </div>

      <section className="block" aria-labelledby="keys">
        <div className="block-head">
          <h2 id="keys">Agent keys</h2>
          <span className="note">{live.length} active</span>
        </div>
        <ul className="list">
          {keys.map((k) => (
            <li key={k.id} className="spread">
              <span className="stack" style={{ gap: 2 }}>
                <span className={`who ${k.revokedAt ? 'who-person' : 'who-agent'}`}>
                  <Icon name="agent" size={16} />
                  {k.label}
                </span>
                <span className="small muted">
                  <span className="mono">sk_agent_...{k.hint}</span> · {k.revokedAt ? (
                    'revoked'
                  ) : k.lastUsedAt ? (
                    <>
                      used <Ago iso={k.lastUsedAt} />
                    </>
                  ) : (
                    'never used'
                  )}
                </span>
              </span>
              {!k.revokedAt && !k.shared && !demo && <RevokeKey id={k.id} label={k.label} />}
              {k.shared && <span className="small muted">Shared with everyone trying the demo; buyers’ details are masked for it</span>}
            </li>
          ))}
        </ul>
        {demo ? <p className="small soft">{SHARED_DEMO_READ_ONLY}</p> : <NewKey />}
      </section>

      <section className="block" aria-labelledby="connect">
        <h2 id="connect">Where agents connect</h2>
        <div className="stack" style={{ gap: 'var(--s4)' }}>
          <p className="soft">
            Connect an agent above: you get a personal URL to paste as a connector in ChatGPT or any MCP client, and the same key works in the
            terminal. Clients that can send headers can also use <span className="mono">{links.sellerMcp}</span> with{' '}
            <span className="mono">Authorization: Bearer sk_agent_...</span>
          </p>
          <div className="field">
            <span className="field-label">For shoppers&apos; assistants (no key)</span>
            <CopyField value={links.shoppingMcp} />
            <span className="hint">
              Every shop on Sayso, yours included. Your shop alone: <span className="mono">{links.shopMcp(shop.slug)}</span>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
