// Where each step of a judge's tour stands, worked out from the tour's results and the live Guard
// records, the order and the shop's rules. The tour page only draws this.

import { formatMoney } from './money.ts';
import { actionAmount } from './guard/describe.ts';
import type { Guard } from './guard/engine.ts';
import { approvalLimit } from './guard/policy.ts';
import type { GuardRecord } from './guard/types.ts';
import type { Orders } from './orders.ts';
import type { SaySo } from './say-so.ts';
import { SELLER_STEPS, TOUR_STEPS, type StepResult, type Tour, type TourStep } from './tour.ts';

/** next: run it now. needs-you: waits on the judge. done: finished. unavailable: can't run here. */
export type StepState = 'next' | 'needs-you' | 'done' | 'unavailable';

export interface StepView {
  step: TourStep;
  state: StepState;
  /** The result in one line. */
  outcome?: string;
  why?: string;
  result?: StepResult;
  records: GuardRecord[];
  /** Say-so requests the judge can decide right here. */
  decide: GuardRecord[];
  payUrl?: string;
  /** The rule the judge's approvals earned ("earn"). */
  suggestion?: { id: string; title: string; evidence: string };
}

export interface TourProgressDeps {
  guard: Guard;
  orders: Orders;
  saySo: SaySo;
}

/** Every step of `tour`, in order, with where it stands now. */
export async function tourProgress(deps: TourProgressDeps, tour: Tour): Promise<StepView[]> {
  const { shopId } = tour;
  const buy = tour.steps.buy;
  const order = buy?.cartId ? (await deps.orders.get(shopId, buy.cartId)).order : undefined;
  const paid = order?.status === 'paid';

  const views: StepView[] = [];
  for (const step of tour.kind === 'seller' ? SELLER_STEPS : TOUR_STEPS) {
    const result = tour.steps[step];
    if (step === 'buy') {
      const captures = buy?.cartId ? await deps.guard.list(shopId, { cartId: buy.cartId, kind: 'payment.capture' }) : [];
      views.push(
        !result
          ? { step, state: 'next', records: [], decide: [] }
          : paid
            ? { step, state: 'done', result, records: captures, decide: [], outcome: `Paid ${order!.total}. Guard checked the stock and captured it in PayPal.` }
            : { step, state: 'needs-you', result, records: captures, decide: [], outcome: 'The cart is ready. Pay for it in PayPal sandbox to place the order.', payUrl: result.approvalUrl },
      );
      continue;
    }
    if (step === 'earn') {
      views.push(await earnView(deps, tour, result));
      continue;
    }
    if (!result) {
      const blocked = step === 'refund' && Boolean(buy) && !paid;
      views.push({ step, state: blocked ? 'unavailable' : 'next', records: [], decide: [], why: blocked ? 'The purchase has to be paid first: there is nothing to refund yet.' : undefined });
      continue;
    }
    const r = result.recordId ? await deps.guard.get(result.recordId) : undefined;
    const pending = r?.status === 'pending_approval';
    views.push({ step, state: pending ? 'needs-you' : 'done', result, records: r ? [r] : [], decide: pending ? [r] : [], outcome: r && outcome(step, r) });
  }
  return views;
}

async function earnView(deps: TourProgressDeps, tour: Tour, result: StepResult | undefined): Promise<StepView> {
  const step = 'earn';
  if (!tour.walletId) return { step, state: 'unavailable', records: [], decide: [], why: 'This step pays for its own order with saved PayPal, and this server has none to lend.' };
  if (!result) return { step, state: 'next', records: [], decide: [] };

  const records = (await Promise.all((result.recordIds ?? []).map((id) => deps.guard.get(id)))).filter((r): r is GuardRecord => Boolean(r));
  const pending = records.filter((r) => r.status === 'pending_approval');
  if (pending.length) {
    const decided = records.length - pending.length;
    const policy = await deps.saySo.policy(tour.shopId);
    const minor = approvalLimit(policy, 'refund.create');
    const limit = minor === undefined ? undefined : formatMoney(minor, policy.currency);
    return { step, state: 'needs-you', result, records, decide: pending, outcome: `Guard held ${records.length} refunds over your ${limit ?? 'refund'} rule. ${decided} decided, ${pending.length} to go.` };
  }
  if (records.some((r) => r.events.some((e) => e.type === 'rejected'))) {
    return { step, state: 'done', result, records, decide: [], outcome: 'You turned at least one down, so Sayso suggests nothing: autonomy only grows from your yeses.' };
  }
  const [suggestion] = (await deps.saySo.autonomy(tour.shopId)).suggestions;
  if (suggestion) return { step, state: 'needs-you', result, records, decide: [], suggestion, outcome: `You approved all ${records.length}. Your approvals earned a rule:` };
  const adopted = (await deps.guard.list(tour.shopId, { kind: 'policy.update' })).find((r) => r.action.actor.type === 'human' && r.status === 'verified' && r.createdAt >= result.at);
  return adopted
    ? { step, state: 'done', result, records: [...records, adopted], decide: [], outcome: 'Adopted. Refunds like these now go through on their own; bigger ones still wait for you. See it in Rules.' }
    : { step, state: 'done', result, records, decide: [], outcome: 'Your agent already had room for these refunds, so none needed you.' };
}

/** The step's result in one line. */
function outcome(step: TourStep, r: GuardRecord): string {
  const amount = actionAmount(r.action) ?? '';
  const lines: Partial<Record<TourStep, Partial<Record<GuardRecord['status'], string>>>> = {
    refund: {
      pending_approval: `Guard held a ${amount} refund. Nothing moves until you decide.`,
      verified: `You said OK. PayPal refunded ${amount}, and Sayso read it back to confirm.`,
      rejected: 'You said no. Nothing moved.',
    },
    rules: {
      pending_approval: "Guard held it: an agent can't change its own rules. Only you can.",
      verified: 'You approved the new rules. (A careful owner would say no.)',
      rejected: 'You said no. The rules stay as they are.',
      failed: 'Not applied: your rules changed after the agent asked, so its old request would have undone that. Guard refused it.',
    },
    commission: {
      pending_approval: `Waiting for you: a ${amount} invoice to someone who has never paid this shop.`,
      verified: 'Sent in PayPal. It is on your Making board, blocked until the buyer pays.',
      rejected: 'You said no. No invoice went out.',
    },
  };
  return lines[step]?.[r.status] ?? `Guard: ${r.status.replace(/_/g, ' ')}. ${r.verification?.detail ?? ''}`.trim();
}
