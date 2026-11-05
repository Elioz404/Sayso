// Who did what, as the owner reads it. New records carry the agent key and its label on the actor; older
// ones only have them inside the actor id, and records are never rewritten, so both read the same.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actorName, agentActor, buyerAgentActor, keyOf, OPS_AGENT, ownerActor } from '../src/core/actors.ts';

test("an owner's agent is named by its key's label, and found by its key", () => {
  const agent = agentActor({ keyId: 'key_7', label: 'Studio laptop: night shift' });
  assert.equal(actorName(agent), 'Studio laptop: night shift', 'a colon in a label is just part of it');
  assert.equal(keyOf(agent), 'key_7');

  const older = { type: 'agent' as const, id: 'agent:Studio laptop: night shift:key_7', side: 'merchant' as const };
  assert.equal(actorName(older), 'Studio laptop: night shift');
  assert.equal(keyOf(older), 'key_7');
});

test('everyone else', () => {
  assert.equal(actorName(ownerActor('shop_maya')), 'You');
  assert.equal(actorName(OPS_AGENT), 'Sayso checkout');
  assert.equal(actorName(buyerAgentActor('mcp')), "Buyer's assistant (over MCP)");
  assert.equal(actorName({ type: 'agent', id: 'buyer-agent:sayso-assistant', side: 'buyer' }), "Buyer's assistant (Shop with AI)");
  assert.equal(keyOf(buyerAgentActor('mcp')), undefined);
  assert.equal(keyOf(ownerActor('shop_maya')), undefined);
});
