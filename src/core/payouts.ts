// Getting paid: an owner connects their own PayPal (partner onboarding), and from then on their sales are
// paid straight into it and refunded from it, with the permissions they granted. Sayso never holds
// their money. Until they connect (and always for the demo shop and judges' tour copies), sales go to
// Sayso's own sandbox account, so anyone can try a shop without setting anything up.
//
// Invoices for custom orders still come from Sayso's account: PayPal only lets approved partners
// invoice on a seller's behalf.

import { randomBytes } from 'node:crypto';
import type { Catalog } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import type { Links } from './links.ts';
import type { PayPalClient } from './paypal/client.ts';
import { connectedSeller, referralLink } from './paypal/partners.ts';
import type { CatalogStore } from './stores.ts';

export interface PayoutsDeps {
  paypal: PayPalClient;
  catalogs: CatalogStore;
  links: Links;
  /** Sayso's own merchant id as a PayPal partner. Without it, payouts can't be connected. */
  partnerMerchantId?: string;
}

export type ConnectOutcome = { status: 'connected'; merchantId: string } | { status: 'pending' } | { status: 'incomplete'; problems: string[] };

export class Payouts {
  private readonly deps: PayoutsDeps;

  constructor(deps: PayoutsDeps) {
    this.deps = deps;
  }

  /** This deployment can connect owners' PayPal accounts. */
  get enabled(): boolean {
    return Boolean(this.deps.partnerMerchantId);
  }

  /** Where the owner signs up or signs in to PayPal to connect it to this shop. */
  async connectLink(shopId: string): Promise<string> {
    const catalog = await this.connectable(shopId);
    return referralLink(
      this.deps.paypal,
      { trackingId: catalog.shop.id, returnUrl: this.deps.links.payoutsReturn },
      `${catalog.shop.id}-payouts-${randomBytes(6).toString('hex')}`, // a fresh link per attempt
    );
  }

  /** After PayPal sends the owner back: ask PayPal what was connected, and keep it if it's complete. */
  async finish(shopId: string, now = new Date()): Promise<ConnectOutcome> {
    const catalog = await this.connectable(shopId);
    const seller = await connectedSeller(this.deps.paypal, this.deps.partnerMerchantId!, catalog.shop.id);
    if (!seller) return { status: 'pending' };
    const problems = [
      ...(seller.permissionsGranted ? [] : ['Sayso was not allowed to take payments and refund them for you.']),
      ...(seller.paymentsReceivable ? [] : ['PayPal says this account cannot receive payments yet.']),
      ...(seller.emailConfirmed ? [] : ["The account's email address is not confirmed with PayPal yet."]),
    ];
    if (problems.length) return { status: 'incomplete', problems };
    await this.deps.catalogs.modify(shopId, (c) => {
      c.shop.payout = { merchantId: seller.merchantId, connectedAt: now.toISOString() };
      return true;
    });
    return { status: 'connected', merchantId: seller.merchantId };
  }

  /** New sales go to Sayso's account again. Sales already paid to the owner stay theirs to refund in PayPal. */
  async disconnect(shopId: string): Promise<void> {
    await this.deps.catalogs.modify(shopId, (c) => {
      if (!c.shop.payout) return false;
      c.shop.payout = undefined;
      return true;
    });
  }

  /** The merchant id a shop's sales are paid into, if the owner connected one. */
  async merchantFor(shopId: string): Promise<string | undefined> {
    return (await this.deps.catalogs.byShopId(shopId))?.shop.payout?.merchantId;
  }

  private async connectable(shopId: string): Promise<Catalog> {
    if (!this.enabled) throw new HttpError(503, 'Connecting your own PayPal is not set up on this server');
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    if (catalog.shop.visibility === 'private') throw new HttpError(403, 'A tour copy is paid into the demo account; it cannot connect a PayPal account');
    return catalog;
  }
}
