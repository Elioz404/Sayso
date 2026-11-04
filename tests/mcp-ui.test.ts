// The cart card: hosts with MCP Apps (ChatGPT among them) learn which tools render it and fetch its HTML.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcp } from '../src/core/mcp.ts';
import { CART_WIDGET_URI, MCP_APP_MIME } from '../src/core/mcp-ui.ts';
import { stack } from './stack.ts';

const rpc = async (method: string, params: Record<string, unknown>, ctx: Parameters<typeof handleMcp>[1]) => ((await handleMcp({ jsonrpc: '2.0', id: 1, method, params }, ctx)) as any).result;

test('cart tools point at the cart card, and the card is served as an MCP App', async () => {
  const s = await stack();
  const buyer = { services: s.services, marketplace: true, channel: 'test' };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' }, buyer);
  assert.ok(init.capabilities.resources, 'resources are advertised');

  const { tools } = await rpc('tools/list', {}, buyer);
  const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]));
  assert.equal(byName.create_cart._meta.ui.resourceUri, CART_WIDGET_URI);
  assert.equal(byName.update_cart._meta['openai/outputTemplate'], CART_WIDGET_URI);
  assert.equal(byName.search_products._meta, undefined, 'only the cart tools render it');

  const { resources } = await rpc('resources/list', {}, buyer);
  assert.deepEqual(resources.map((r: any) => r.uri), [CART_WIDGET_URI]);
  const { contents } = await rpc('resources/read', { uri: CART_WIDGET_URI }, buyer);
  assert.equal(contents[0].mimeType, MCP_APP_MIME);
  assert.match(contents[0].text, /ui\/notifications\/tool-result/);
  assert.deepEqual(contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] }, 'the card makes no outside requests');
});

test("the owner's endpoint has no cart card, and unknown resources are refused", async () => {
  const s = await stack();
  const owner = { services: s.services, channel: 'test', ...s.owner };
  assert.deepEqual((await rpc('resources/list', {}, owner)).resources, []);
  const reply = (await handleMcp({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://other' } }, { services: s.services, marketplace: true, channel: 'test' })) as any;
  assert.equal(reply.error.code, -32002);
});
