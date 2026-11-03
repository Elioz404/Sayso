import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ABOUT } from '../src/core/about.ts';

test('the server, the CLI and package.json report the same version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const cli = await readFile(new URL('../cli/sayso.ts', import.meta.url), 'utf8');
  assert.equal(ABOUT.version, pkg.version);
  assert.equal(/const VERSION = '([^']+)'/.exec(cli)?.[1], pkg.version);
});

test("the live demo shop takes the code's words and photos but keeps visitors' prices and stock", async () => {
  const { demoCatalog, refreshDemoPresentation } = await import('../src/core/demo-shop.ts');
  const live = structuredClone(demoCatalog);
  live.products[0].name = 'Old name';
  (live.products[0] as { imageCredit?: unknown }).imageCredit = { author: 'someone' };
  live.products[0].paypalProductId = 'PROD-1';
  live.products[0].variants[1].price = 3_900;
  live.products[0].variants[1].inventory = 2;

  assert.equal(refreshDemoPresentation(live, demoCatalog), true);
  assert.equal(live.products[0].name, demoCatalog.products[0].name);
  assert.equal('imageCredit' in live.products[0], false, 'fields the code no longer has are gone');
  assert.equal(live.products[0].paypalProductId, 'PROD-1');
  assert.deepEqual([live.products[0].variants[1].price, live.products[0].variants[1].inventory], [3_900, 2]);
  assert.equal(refreshDemoPresentation(live, demoCatalog), false, 'nothing to change the second time');
});
