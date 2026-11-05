// The owner area: a side rail with one view per job. Signed-out visitors get the sign-in screen.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { RailDrawer, RailNav, TabBar } from '@/app/_components/client-ui.tsx';
import { LoginForm, ShopSwitcher, SignOut } from '@/app/_components/owner-actions.tsx';
import { OwnerDock } from '@/app/_components/owner-dock.tsx';
import { When } from '@/app/_components/time.tsx';
import { Icon, Mark, Status } from '@/app/_components/ui.tsx';
import { demoEnabled, paypalLoginEnabled } from '@/server/context.ts';
import { ownerView, pendingFor, signedInSeller } from '@/server/owner.ts';

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
        <LoginForm demo={demoEnabled()} paypal={paypalLoginEnabled()} />
        <p className="small soft">
          No shop yet? <a href="/start">Draft one from photos and a price list</a>.
        </p>
      </main>
    );
  }

  const { shop, shopId } = view;
  const [pending, seller] = await Promise.all([pendingFor(shopId).then((p) => p.length), signedInSeller()]);
  const tour = await view.tours?.forShop(shopId);
  const onTour = Boolean(tour);
  const status = shop.status ?? 'live';

  return (
    <div className="owner">
      <aside className="rail">
        <RailDrawer
          brand={
            <a href="/" className="brand" aria-label="Sayso home">
              <Mark />
              <span className="brand-word">sayso</span>
            </a>
          }
          waiting={pending}
        >
          <div className="rail-shop">
            {seller && seller.shops.length > 1 ? <ShopSwitcher shops={seller.shops} current={shop.slug} /> : <b>{shop.name}</b>}
            <Status value={status} />
            {seller && shop.sellerId === seller.id && <span className="rail-seller">PayPal: {seller.email ?? seller.name ?? 'signed in'}</span>}
          </div>
          <RailNav
            items={[
              { href: '/owner', label: 'Overview', icon: 'home', count: pending },
              { href: '/owner/assistant', label: 'Assistant', icon: 'chat' },
              { href: '/owner/orders', label: 'Orders', icon: 'list' },
              { href: '/owner/catalog', label: 'Catalog', icon: 'box' },
              { href: '/owner/production', label: 'Making', icon: 'calendar' },
              { href: '/owner/rules', label: 'Rules', icon: 'shield' },
              { href: '/owner/agents', label: 'Agents', icon: 'agent' },
              { href: '/owner/activity', label: 'Activity', icon: 'activity' },
              { href: '/owner/phone', label: 'On your phone', icon: 'phone' },
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
        </RailDrawer>
      </aside>
      <main className="owner-main">
        <div className="owner-body">
          {onTour && (
            <div className="callout">
              <span className="small">
                {tour?.kind === 'seller' ? (
                  <>
                    <b>A For Judges shop.</b> Everything here is real; it closes <When iso={tour.expiresAt} />.
                  </>
                ) : (
                  <>
                    <b>This is your private copy of the demo shop.</b> Everything here is real and yours alone.
                  </>
                )}
              </span>
              <a className="btn btn-small" href="/tour#sell">
                Back to For Judges
              </a>
            </div>
          )}
          {children}
        </div>
      </main>
      <TabBar waiting={pending} />
      <OwnerDock chat={`${shopId}:${view.demo ? 'demo' : 'owner'}`} shopName={shop.name} />
    </div>
  );
}
