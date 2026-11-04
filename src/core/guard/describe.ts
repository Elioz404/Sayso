// How a Guard action reads to people, in one place: the approval screen, the owner's lists, phone
// notifications and agent replies all use these, so they never disagree.

import { DEFAULT_CURRENCY, formatMoney } from '../money.ts';
import { ACTIONS, type ProposedAction } from './types.ts';

/** "$82.00", or undefined when the action moves no money (a rule change) or the amount isn't known yet. */
export function actionAmount(action: Pick<ProposedAction, 'kind' | 'amount' | 'currency'>): string | undefined {
  if (action.amount === undefined || action.kind === 'policy.update') return undefined;
  return formatMoney(action.amount, action.currency ?? DEFAULT_CURRENCY);
}

/** "Refund $82.00", "Change your rules". */
export function actionTitle(action: Pick<ProposedAction, 'kind' | 'amount' | 'currency'>): string {
  return [ACTIONS[action.kind].label, actionAmount(action)].filter(Boolean).join(' ');
}

/** Who asked, in a few words: "Your agent", "A buyer's assistant". */
export function askerOf(action: Pick<ProposedAction, 'actor'>): string {
  if (action.actor.type !== 'agent') return 'You';
  if (action.actor.id === 'buyer-agent:sayso-order') return 'The buyer';
  return action.actor.side === 'buyer' ? 'A buyer’s assistant' : 'Your agent';
}
