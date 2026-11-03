// The made-to-order board: what the owner still has to make, with PayPal deciding when work can start.
import type { Metadata } from 'next';
import { ProductionBoard } from '@/app/_components/production-board.tsx';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Making' };

export default async function Making() {
  const view = await ownerView();
  if (!view) return null;
  const jobs = await view.production.jobs(view.shopId);
  const blocked = jobs.filter((j) => j.blockedBy).length;

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Making</h1>
          <p className="sub">
            Made-to-order pieces and commissions still to make.{' '}
            {blocked ? `${blocked} can't start yet: waiting for a payment or your OK.` : jobs.length ? 'Everything here is paid for.' : ''}
          </p>
        </div>
      </div>
      {jobs.length === 0 ? (
        <div className="empty">
          <b>Nothing to make right now.</b>
          <span className="small">
            Paid orders for made-to-order items and invoices with a lead time show up here. Your agent can add one: <span className="mono">sayso invoice grace@example.com &quot;Custom vase&quot; 62.00 --deposit 31.00 --make-days 12</span>
          </span>
        </div>
      ) : (
        <ProductionBoard jobs={jobs} today={view.production.today()} />
      )}
    </>
  );
}
