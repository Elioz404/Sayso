// Trust report: what the owner's agents (and buyers' assistants) did with the shop's money, what Guard did
// about each request, where sales came from, and every order's money trail checked against PayPal and the
// audit chain. Drawn with AG Studio; the rows come from src/core/trust-report.ts.
import type { Metadata } from 'next';
import { TrustReportView } from '@/app/_components/trust-report-view.tsx';
import { trustReport } from '@/core/trust-report.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Trust report' };

export default async function TrustPage() {
  const view = await ownerView();
  if (!view) return null;
  const { saySo, shopId, shop, orders, redact } = view;
  const [records, placed, policy] = await Promise.all([saySo.audit(shopId, 2000), orders.list(shopId), saySo.policy(shopId)]);
  const refundRule = policy.rules.find((r) => r.type === 'max_amount' && r.kinds.includes('refund.create'));
  const report = trustReport(records, placed, shop.currency, refundRule?.type === 'max_amount' ? refundRule.limit : undefined);
  // The shared demo shows people's details masked, as everywhere else in it.
  const data = {
    ...report,
    decisions: report.decisions.map((d) => ({ ...d, why: redact(d.why) })),
    trail: report.trail.map((t) => ({ ...t, buyer: redact(t.buyer) })),
  };
  return (
    <>
      <div className="view-head">
        <div>
          <h1>Trust report</h1>
          <p className="sub">What your agents did with your money, what Guard held for you, and where your sales come from.</p>
        </div>
      </div>
      <TrustReportView data={data} licenseKey={process.env.AG_STUDIO_LICENSE_KEY || undefined} />
    </>
  );
}
