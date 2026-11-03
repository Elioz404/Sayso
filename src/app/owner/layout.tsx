// The owner area: a side rail with one view per job. Signed-out visitors get the sign-in screen.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { RailNav } from '@/app/_components/client-ui.tsx';
import { LoginForm, SignOut } from '@/app/_components/owner-actions.tsx';
import { Icon, Mark, Status } from '@/app/_components/ui.tsx';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Your shop' };

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const view = await ownerView();
  if (!view) {
    return (
      <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h1>Sign in to your shop</h1>
          <p className="soft">Approve what your agents ask for, publish your catalog and manage agent keys.</p>
        </div>
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} />
        <p className="small soft">
          No shop yet? <a href="/start">Draft one from photos and a price list</a>.
        </p>
      </main>
    );
  }

  const { shop, seller, shopId } = view;
  const pending = (await seller.approvals(shopId)).length;
  const status = shop.status ?? 'live';

  return (
    <div className="owner">
      <aside className="rail">
        <div className="rail-inner">
          <div className="rail-top">
            <a href="/" className="brand" aria-label="Sayso home">
              <Mark />
              <span className="brand-word">sayso</span>
            </a>
            <span className="rail-top-mobile">
              <SignOut />
            </span>
          </div>
          <div className="rail-shop">
            <b>{shop.name}</b>
            <Status value={status} />
          </div>
          <RailNav
            items={[
              { href: '/owner', label: 'Overview', icon: 'home', count: pending },
              { href: '/owner/orders', label: 'Orders', icon: 'list' },
              { href: '/owner/catalog', label: 'Catalog', icon: 'box' },
              { href: '/owner/rules', label: 'Rules', icon: 'shield' },
              { href: '/owner/agents', label: 'Agents', icon: 'agent' },
              { href: '/owner/activity', label: 'Activity', icon: 'activity' },
            ]}
          />
          <div className="rail-foot">
            {status === 'live' && (
              <a className="btn btn-quiet btn-small" href={`/shop/${shop.slug}`} style={{ justifyContent: 'flex-start' }}>
                <Icon name="external" size={16} /> View public shop
              </a>
            )}
            <SignOut />
          </div>
        </div>
      </aside>
      <main className="owner-main">
        <div className="owner-body">{children}</div>
      </main>
    </div>
  );
}
