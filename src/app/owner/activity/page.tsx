import type { Metadata } from 'next';
import { AuditGrid, type AuditRow } from '@/app/_components/grids.tsx';
import { ownerView } from '@/server/owner.ts';
import { recordView, whyNow } from '@/core/record-view.ts';

export const metadata: Metadata = { title: 'Activity' };

export default async function Activity() {
  const view = await ownerView();
  if (!view) return null;
  const { saySo, shopId, redact } = view;
  const audit = await saySo.audit(shopId, 500);
  const tampered = audit.filter((r) => !r.chainIntact).length;

  const rows: AuditRow[] = audit.map((r) => {
    const v = recordView(r, redact);
    return {
      id: v.id,
      at: v.at,
      action: v.action,
      amount: v.amount ?? '',
      stopped: v.stopped,
      by: v.by,
      byAgent: v.byAgent,
      status: v.status,
      why: whyNow(v),
      tampered: !v.chainIntact,
      outcome: v.outcome,
      paypal: v.paypal,
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
