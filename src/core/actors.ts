// Actors Sayso itself acts as. Kept apart from the services so UI code can recognise them without
// pulling server code into the browser.

import { ACTIONS, type ActionKind, type Actor } from './guard/types.ts';

/** The shop's own operations agent: it captures paid orders and releases holds on the shop's behalf. */
export const OPS_AGENT: Actor = { type: 'agent', id: 'sayso-ops-agent', side: 'merchant' };

/** The signed-in owner of `shopId`, the only one whose say-so counts. */
export function ownerActor(shopId: string): Actor {
  return { type: 'human', id: `owner:${shopId}`, side: 'merchant' };
}

/** The owner's own agent, acting with one of the shop's agent keys. */
export function agentActor(key: { keyId: string; label: string }): Actor {
  return { type: 'agent', id: `agent:${key.label}:${key.keyId}`, side: 'merchant', keyId: key.keyId, label: key.label };
}

/** A buyer's assistant, shopping from `channel`. */
export function buyerAgentActor(channel: string): Actor {
  return { type: 'agent', id: `buyer-agent:${channel}`, side: 'buyer', channel };
}

type ActorLike = Pick<Actor, 'type' | 'id'> & Partial<Actor>;

/**
 * The agent key an owner's agent acted with. Records written before actors carried it have it only at the
 * end of their id ("agent:<label>:<key id>"), and records are never rewritten, so it is read from there.
 */
export function keyOf(actor: ActorLike): string | undefined {
  if (actor.type !== 'agent' || !actor.id.startsWith('agent:')) return undefined;
  return actor.keyId ?? (actor.id.split(':').length > 2 ? actor.id.split(':').at(-1) : undefined);
}

/** How an actor reads to the owner: their agents by label, buyers' assistants as such, people as "You". */
export function actorName(actor: ActorLike): string {
  if (actor.type !== 'agent') return actor.id.startsWith('owner:') ? 'You' : actor.id;
  if (actor.id === OPS_AGENT.id) return 'Sayso checkout';
  const [, ...rest] = actor.id.split(':');
  if (actor.side === 'buyer') {
    const channel = actor.channel ?? (rest.join(':') || actor.id);
    return `Buyer's assistant (${BUYER_CHANNEL[channel] ?? channel})`;
  }
  // Older records: "agent:<label>:<key id>", where the label may itself hold a colon.
  return actor.label ?? ((rest.length > 1 ? rest.slice(0, -1).join(':') : rest[0]) || actor.id);
}

/** Where a buyer's assistant came from, as an owner would say it. */
const BUYER_CHANNEL: Record<string, string> = { 'sayso-assistant': 'Shop with AI', mcp: 'over MCP', 'tour-assistant': 'For Judges', test: 'test' };

/** How an action reads to people, from the one list Guard governs. */
export function actionLabel(kind: string): string {
  return kind in ACTIONS ? ACTIONS[kind as ActionKind].label : kind;
}
