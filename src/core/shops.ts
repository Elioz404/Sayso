// Shop lifecycle: onboard (AI draft) -> owner reviews -> publish (PayPal Catalog Products) -> live for
// buyer agents. Creating a shop also returns its two credentials, each exactly once: the owner secret
// and a first agent key for the owner's own AI agent.

import type { Access } from './access.ts';
import { draftCatalog, type OnboardingInput } from './ai/onboarding.ts';
import type { ChatModel } from './ai/llm.ts';
import { findVariant, type Catalog } from './catalog.ts';
import { fromLlmError, HttpError, notFound } from './errors.ts';
import type { Links } from './links.ts';
import type { PayPalClient } from './paypal/client.ts';
import { createCatalogProduct } from './paypal/products.ts';
import type { CatalogStore } from './stores.ts';

export interface ShopsDeps {
  catalogs: CatalogStore;
  access: Access;
  paypal: PayPalClient;
  model?: ChatModel;
  links: Links;
}

export interface OnboardResult {
  catalog: Catalog;
  questions: string[];
  ownerSecret: string;
  agentKey: string;
}

export class Shops {
  private readonly deps: ShopsDeps;

  constructor(deps: ShopsDeps) {
    this.deps = deps;
  }

  async onboard(input: OnboardingInput, agentLabel = 'my agent'): Promise<OnboardResult> {
    if (!this.deps.model) throw new HttpError(503, 'Onboarding needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    const { catalog, questions } = await draftCatalog(this.deps.model, input).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read that catalog');
    });
    await this.deps.catalogs.save(catalog);
    const ownerSecret = await this.deps.access.createOwner(catalog.shop.id);
    const { secret: agentKey } = await this.deps.access.createAgentKey(catalog.shop.id, agentLabel);
    return { catalog, questions, ownerSecret, agentKey };
  }

  /** Owner only. Registers products with PayPal and opens the shop to buyer agents. */
  async publish(shopId: string): Promise<{ catalog: Catalog; warnings: string[] }> {
    const catalog = await this.get(shopId);
    const warnings: string[] = [];
    for (const product of catalog.products) {
      if (product.paypalProductId) continue;
      try {
        const created = await createCatalogProduct(
          this.deps.paypal,
          { name: product.name, description: product.description, imageUrl: product.imageUrl, homeUrl: this.deps.links.shopPage(catalog.shop.slug) },
          `${shopId}-${product.id}-catalog`,
        );
        product.paypalProductId = created.id;
      } catch (err) {
        // A catalog sync hiccup should not keep a seller offline; checkout doesn't depend on it.
        warnings.push(`${product.name}: not registered in PayPal's catalog (${err instanceof Error ? err.message : 'error'})`);
      }
    }
    catalog.shop.status = 'live';
    await this.deps.catalogs.save(catalog);
    return { catalog, warnings };
  }

  async setVariant(shopId: string, variantId: string, patch: { price?: number; inventory?: number }): Promise<Catalog> {
    const catalog = await this.get(shopId);
    const found = findVariant(catalog, variantId);
    if (!found) throw notFound(`Variant ${variantId}`);
    if (patch.price !== undefined) {
      if (!Number.isInteger(patch.price) || patch.price <= 0) throw new HttpError(400, 'Price must be a positive amount');
      found.variant.price = patch.price;
    }
    if (patch.inventory !== undefined) {
      if (!Number.isInteger(patch.inventory) || patch.inventory < 0) throw new HttpError(400, 'Stock must be a whole number, 0 or more');
      found.variant.inventory = patch.inventory;
    }
    await this.deps.catalogs.save(catalog);
    return catalog;
  }

  async get(shopId: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    return catalog;
  }
}
