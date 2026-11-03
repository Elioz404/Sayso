// PayPal Catalog Products: each published product is registered so PayPal knows what the shop sells.

import type { PayPalClient } from './client.ts';

/** Registers a product in PayPal's Catalog Products API when a shop is published. */
export const createCatalogProduct = (
  client: PayPalClient,
  input: { name: string; description: string; imageUrl?: string; homeUrl?: string },
  idempotencyKey: string,
) =>
  client.post<{ id: string }>(
    '/v1/catalogs/products',
    {
      name: input.name.slice(0, 127),
      description: input.description.slice(0, 256) || undefined,
      type: 'PHYSICAL',
      image_url: input.imageUrl,
      home_url: input.homeUrl,
    },
    idempotencyKey,
  );
