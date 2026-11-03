// The demo seller used in tests, local dev and the video: a one-person ceramics studio that sells
// through Instagram DMs today. Prices in USD cents.

import type { Catalog } from './catalog.ts';

export const demoCatalog: Catalog = {
  shop: {
    id: 'shop_maya',
    slug: 'maya-ceramics',
    name: 'Maya Ceramics',
    currency: 'USD',
    country: 'US',
    shipping: [
      { id: 'us-ground', name: 'USPS Ground Advantage', countries: ['US'], price: 895, freeAbove: 7_500, minDays: 3, maxDays: 5 },
      { id: 'us-priority', name: 'USPS Priority Mail', countries: ['US'], price: 1_495, minDays: 1, maxDays: 3 },
      { id: 'intl', name: 'International (tracked)', countries: ['CA', 'GB', 'DE', 'FR', 'ES', 'AU', 'MX', 'JP'], price: 2_800, minDays: 7, maxDays: 14 },
    ],
    taxBps: { 'US-OR': 0, 'US-CA': 725, 'US-NY': 400, US: 600 },
    returnPolicy: { days: 30, buyerPaysReturn: false },
  },
  products: [
    {
      id: 'prod_mug',
      shopId: 'shop_maya',
      name: 'Hand-thrown Mug',
      description: 'Wheel-thrown stoneware mug, 12 oz, dishwasher safe. Each one is slightly different.',
      category: 'home/kitchen',
      tags: ['mug', 'handmade', 'gift', 'coffee'],
      variants: [
        { id: 'var_mug_speckled', productId: 'prod_mug', title: 'Speckled White', price: 3_400, inventory: 1, attributes: { glaze: 'Speckled White', size: '12 oz' } },
        { id: 'var_mug_sage', productId: 'prod_mug', title: 'Sage Green', price: 3_400, inventory: 6, attributes: { glaze: 'Sage Green', size: '12 oz' } },
        { id: 'var_mug_midnight', productId: 'prod_mug', title: 'Midnight Blue', price: 3_600, inventory: 0, attributes: { glaze: 'Midnight Blue', size: '12 oz' } },
      ],
    },
    {
      id: 'prod_bowl',
      shopId: 'shop_maya',
      name: 'Ramen Bowl',
      description: 'Deep 7-inch stoneware bowl with a glossy interior.',
      category: 'home/kitchen',
      tags: ['bowl', 'handmade', 'ramen'],
      variants: [
        { id: 'var_bowl_sand', productId: 'prod_bowl', title: 'Sand', price: 4_800, inventory: 3, attributes: { glaze: 'Sand' } },
      ],
    },
    {
      id: 'prod_vase',
      shopId: 'shop_maya',
      name: 'Custom Bud Vase',
      description: 'Made to order in your choice of glaze. Ships in about 10 days.',
      category: 'home/decor',
      tags: ['vase', 'custom', 'gift'],
      variants: [
        { id: 'var_vase_custom', productId: 'prod_vase', title: 'Made to order', price: 6_200, inventory: 0, attributes: { lead_time: '10 days' }, madeToOrderDays: 10 },
      ],
    },
  ],
};
