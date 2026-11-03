// Which policy is in force for an owner: the one they saved, or sensible defaults in their currency.
// Owners are shops (merchant defaults) or buyers' wallets (buyer defaults); Guard and the dashboard
// both resolve policies through here so they can never disagree.

import { defaultBuyerPolicy, defaultMerchantPolicy, type Policy } from './guard/policy.ts';
import type { PolicyStore } from './guard/policy-store.ts';
import { DEFAULT_CURRENCY } from './money.ts';
import type { CatalogStore } from './stores.ts';

export type PolicyLookup = (ownerId: string) => Promise<Policy>;

export function policyLookup(policies: PolicyStore, catalogs: CatalogStore): PolicyLookup {
  return async (ownerId) => {
    const saved = await policies.get(ownerId);
    if (saved) return saved;
    const catalog = await catalogs.byShopId(ownerId);
    return catalog ? defaultMerchantPolicy(ownerId, catalog.shop.currency) : defaultBuyerPolicy(ownerId, DEFAULT_CURRENCY);
  };
}
