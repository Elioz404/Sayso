// What Sayso says about itself: the version servers and the CLI report, and where its source lives.
// tests/about.test.ts keeps the version in step with package.json and the CLI.

import { demoCatalog } from './demo-shop.ts';

export const ABOUT = {
  version: '0.3.0',
  repository: 'https://github.com/Elioz404/Sayso',
  /** The always-on demo shop, for links on the site. */
  demoShop: demoCatalog.shop.slug,
} as const;
