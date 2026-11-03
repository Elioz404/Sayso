// Tells the owner something is waiting for their say-so, outside the agent's reach: the agent never
// sees the approval channel. Always logged; also pushed to a phone through ntfy for the one shop the
// configured topic belongs to (SAYSO_NTFY_TOPIC + SAYSO_NTFY_SHOP). ntfy topics are readable by anyone
// who knows the name, so the push carries what kind of request it is and a link, never buyer details.

import 'server-only';
import { ACTIONS, type GuardRecord } from '@/core/guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney } from '@/core/money.ts';

export async function notifyOwner(record: GuardRecord, approveUrl: string): Promise<void> {
  const amount = record.action.amount !== undefined ? ` ${formatMoney(record.action.amount, record.action.currency ?? DEFAULT_CURRENCY)}` : '';
  const title = `Say-so needed: ${ACTIONS[record.action.kind].label}${amount}`;
  console.log(`[guard] ${record.id} for ${record.action.ownerId}: ${title} -> ${approveUrl}`);

  const topic = process.env.SAYSO_NTFY_TOPIC;
  if (!topic || record.action.ownerId !== process.env.SAYSO_NTFY_SHOP) return;
  try {
    await fetch(`${process.env.SAYSO_NTFY_URL ?? 'https://ntfy.sh'}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: title, Click: approveUrl, Tags: 'raised_hand', Priority: 'high' },
      body: 'Open the link to see who asked, why, and what would happen.',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error('[guard] owner push failed', err);
  }
}
