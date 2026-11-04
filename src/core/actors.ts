// Actors Sayso itself acts as. Kept apart from the services so UI code can recognise them without
// pulling server code into the browser.

import { ACTIONS, type ActionKind, type Actor } from './guard/types.ts';

/** The shop's own operations agent: it captures paid orders and releases holds on the shop's behalf. */
export const OPS_AGENT: Actor = { type: 'agent', id: 'sayso-ops-agent', side: 'merchant' };

/** The signed-in owner of `shopId`, the only one whose say-so counts. */
export function ownerActor(shopId: string): Actor {
  return { type: 'human', id: `owner:${shopId}`, side: 'merchant' };
}

/** How an actor reads to the owner: their agents by label, buyers' assistants as such, people as "You". */
export function actorName(actor: { type: 'agent' | 'human'; id: string; side?: 'buyer' | 'merchant' }): string {
  if (actor.type !== 'agent') return actor.id.startsWith('owner:') ? 'You' : actor.id;
  if (actor.id === OPS_AGENT.id) return 'Sayso checkout';
  const label = actor.id.split(':')[1] ?? actor.id;
  return actor.side === 'buyer' ? `Buyer's assistant (${BUYER_CHANNEL[label] ?? label})` : label;
}

/** Where a buyer's assistant came from, as an owner would say it. */
const BUYER_CHANNEL: Record<string, string> = { 'sayso-assistant': 'Shop with AI', mcp: 'over MCP', 'tour-assistant': 'For Judges', test: 'test' };

/** How an action reads to people, from the one list Guard governs. */
export function actionLabel(kind: string): string {
  return kind in ACTIONS ? ACTIONS[kind as ActionKind].label : kind;
}
