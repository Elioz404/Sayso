// GET: the Overview's "In depth" report over the last 90 days: every request and what Guard did, sales by
// channel, each order's money trail, each record's hash chain checked. Asked for only when that section
// comes into view, so the Overview itself reads just the two weeks it shows. Masked for the shared demo.
import { HttpError } from '@/core/errors.ts';
import { approvalLimit } from '@/core/guard/policy.ts';
import { trustReport } from '@/core/trust-report.ts';
import { handle, requireOwnerSession } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

const REPORT_DAYS = 90;
/** The most records it reads in that window. */
const REPORT_RECORDS = 2_000;

export async function GET(request: Request) {
  return handle(async () => {
    await requireOwnerSession(request);
    const view = await ownerView();
    if (!view) throw new HttpError(401, 'Sign in as the shop owner first');
    const { shopId, shop, orders, saySo, redact } = view;
    const since = new Date(Date.now() - REPORT_DAYS * 86_400_000);
    const [list, records, policy] = await Promise.all([orders.list(shopId, { since }), saySo.audit(shopId, REPORT_RECORDS, since), saySo.policy(shopId)]);
    const report = trustReport(records, list, shop.currency, approvalLimit(policy, 'refund.create'));
    return Response.json({
      ...report,
      decisions: report.decisions.map((d) => ({ ...d, why: redact(d.why) })),
      trail: report.trail.map((t) => ({ ...t, buyer: redact(t.buyer) })),
    });
  });
}
