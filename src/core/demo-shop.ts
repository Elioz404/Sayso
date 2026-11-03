// The demo seller used in tests, local dev and the video: a one-person ceramics studio that sells
// through Instagram DMs today. Prices in USD cents. Photos are openly licensed pictures of real studio
// pottery from Wikimedia Commons, served from there and credited on the shop page.

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
    cover: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Ceramics_studio%2C_Epworth_Studios%2C_Liskeard%2C_Cornwall_-_September_2026_%282%29.jpg/1280px-Ceramics_studio%2C_Epworth_Studios%2C_Liskeard%2C_Cornwall_-_September_2026_%282%29.jpg',
      alt: 'A pottery studio: a wooden worktable with three pale stoneware vases, shelves of glazes behind',
      credit: {
        author: 'Mutney',
        license: 'CC BY 4.0',
        source: 'https://commons.wikimedia.org/wiki/File:Ceramics_studio,_Epworth_Studios,_Liskeard,_Cornwall_-_September_2026_(2).jpg',
      },
    },
  },
  products: [
    {
      id: 'prod_mug',
      shopId: 'shop_maya',
      name: 'Hand-thrown Mug',
      description: 'Wheel-thrown stoneware mug, 12 oz, dishwasher safe. Each one is slightly different.',
      category: 'home/kitchen',
      tags: ['mug', 'handmade', 'gift', 'coffee'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Studio_Ceramics_Cup_by_Bernard_Leach_%28YORYM-2004.1.2022.5%29.JPG/960px-Studio_Ceramics_Cup_by_Bernard_Leach_%28YORYM-2004.1.2022.5%29.JPG',
      imageCredit: { author: 'York Museums Trust', license: 'CC BY-SA 3.0', source: 'https://commons.wikimedia.org/wiki/File:Studio_Ceramics_Cup_by_Bernard_Leach_(YORYM-2004.1.2022.5).JPG' },
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
      description: 'Wide 7-inch stoneware bowl in a dark hare\'s-fur glaze, glossy inside.',
      category: 'home/kitchen',
      tags: ['bowl', 'handmade', 'ramen'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Bowl_with_%22Hare%27s-Fur%22_Glaze_MET_DP274022.jpg/960px-Bowl_with_%22Hare%27s-Fur%22_Glaze_MET_DP274022.jpg',
      imageCredit: { author: 'The Metropolitan Museum of Art', license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Bowl_with_%22Hare%27s-Fur%22_Glaze_MET_DP274022.jpg' },
      variants: [
        { id: 'var_bowl_sand', productId: 'prod_bowl', title: "Hare's Fur", price: 4_800, inventory: 3, attributes: { glaze: "Hare's Fur" } },
      ],
    },
    {
      id: 'prod_vase',
      shopId: 'shop_maya',
      name: 'Custom Vase',
      description: 'Made to order in your choice of glaze. Ships in about 10 days.',
      category: 'home/decor',
      tags: ['vase', 'custom', 'gift'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Vase%2C_by_Kitamura_Junko.jpg/960px-Vase%2C_by_Kitamura_Junko.jpg',
      imageCredit: { author: 'Brooklyn Museum', license: 'CC BY 2.0', source: 'https://commons.wikimedia.org/wiki/File:Vase,_by_Kitamura_Junko.jpg' },
      variants: [
        { id: 'var_vase_custom', productId: 'prod_vase', title: 'Made to order', price: 6_200, inventory: 0, attributes: { lead_time: '10 days' }, madeToOrderDays: 10 },
      ],
    },
  ],
};
