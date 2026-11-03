// Actors Sayso itself acts as. Kept apart from the services so UI code can recognise them without
// pulling server code into the browser.

import type { Actor } from './guard/types.ts';

/** The shop's own operations agent: it captures paid orders and releases holds on the shop's behalf. */
export const OPS_AGENT: Actor = { type: 'agent', id: 'sayso-ops-agent', side: 'merchant' };

/** The signed-in owner of `shopId`, the only one whose say-so counts. */
export function ownerActor(shopId: string): Actor {
  return { type: 'human', id: `owner:${shopId}`, side: 'merchant' };
}
