import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { NewKey, RevokeKey } from '@/app/_components/owner-actions.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { ago, ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Agents' };

export default async function Agents() {
  const view = await ownerView();
  if (!view) return null;
  const { access, shopId, shop, baseUrl } = view;
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
                  <span className="mono">sk_agent_...{k.hint}</span> · {k.revokedAt ? 'revoked' : k.lastUsedAt ? `used ${ago(k.lastUsedAt)}` : 'never used'}
                </span>
              </span>
              {!k.revokedAt && <RevokeKey id={k.id} label={k.label} />}
            </li>
          ))}
        </ul>
        <NewKey />
      </section>

      <section className="block" aria-labelledby="connect">
        <h2 id="connect">Connect an agent</h2>
        <div className="stack" style={{ gap: 'var(--s4)' }}>
          <div className="field">
            <span className="field-label">From a terminal</span>
            <CopyField value={`node cli/sayso.ts login --url ${baseUrl} --key sk_agent_...`} />
          </div>
          <div className="field">
            <span className="field-label">From any MCP client</span>
            <CopyField value={`${baseUrl}/api/mcp`} />
            <span className="hint">Send the key as the header Authorization: Bearer sk_agent_...</span>
          </div>
          <div className="field">
            <span className="field-label">For shoppers&apos; assistants (no key)</span>
            <CopyField value={`${baseUrl}/api/shops/${shop.slug}/mcp`} />
          </div>
        </div>
      </section>
    </>
  );
}
