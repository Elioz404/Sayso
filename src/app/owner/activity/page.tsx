import { actionAmount } from '@/core/guard/describe.ts';
import type { Metadata } from 'next';
import { AuditGrid, type AuditRow } from '@/app/_components/grids.tsx';
import { actionLabel, actorName } from '@/app/_components/ui.tsx';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Activity' };

export default async function Activity() {
  const view = await ownerView();
  if (!view) return null;
  const { saySo, shopId, redact } = view;
  const audit = await saySo.audit(shopId, 500);
  const tampered = audit.filter((r) => !r.chainIntact).length;

  const rows: AuditRow[] = audit.map((r) => {
    const agent = r.action.actor.type === 'agent';
    return {
      id: r.id,
      at: r.createdAt,
      action: actionLabel(r.action.kind),
      amount: actionAmount(r.action) ?? '',
      by: actorName(r.action.actor),
      byAgent: agent,
      status: r.status,
      why: redact(r.decision?.hits.map((h) => h.message).join(' ') || r.action.reason),
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
