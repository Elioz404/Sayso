import type { Metadata } from 'next';
import { AuditGrid, type AuditRow } from '@/app/_components/grids.tsx';
import { ACTION_LABEL } from '@/app/_components/ui.tsx';
import { formatMoney } from '@/core/money.ts';
import { ownerView, when } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Activity' };

export default async function Activity() {
  const view = await ownerView();
  if (!view) return null;
  const { seller, shopId, shop } = view;
  const audit = await seller.audit(shopId, 500);
  const tampered = audit.filter((r) => !r.chainIntact).length;

  const rows: AuditRow[] = audit.map((r) => {
    const agent = r.action.actor.type === 'agent';
    return {
      id: r.id,
      at: when(r.createdAt),
      action: ACTION_LABEL[r.action.kind] ?? r.action.kind,
      amount: r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? shop.currency) : '',
      by: agent ? (r.action.actor.id === 'sayso-ops-agent' ? 'Sayso checkout' : (r.action.actor.id.split(':')[1] ?? 'agent')) : 'You',
      byAgent: agent,
      status: r.status,
      why: r.decision?.hits.map((h) => h.message).join(' ') || r.action.reason,
      tampered: !r.chainIntact,
    };
  });

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Activity</h1>
          <p className="sub">
            Every money movement and rule change, newest first.{' '}
            {audit.length === 0
              ? ''
              : tampered
                ? `${tampered} record${tampered === 1 ? ' was' : 's were'} edited after the fact.`
                : `All ${audit.length} records check out against their hash chain.`}
          </p>
        </div>
      </div>
      <AuditGrid rows={rows} />
    </>
  );
}
