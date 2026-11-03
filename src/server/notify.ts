// Tells the owner something is waiting for their say-so, outside the agent's reach: the agent never
// sees the approval channel. Always logged; also pushed to the owner's phone through ntfy when
// SAYSO_NTFY_TOPIC is set (the push carries a link, never a secret).

import 'server-only';
import { formatMoney } from '@/core/money.ts';
import type { GuardRecord } from '@/core/guard/types.ts';

export async function notifyOwner(record: GuardRecord, approveUrl: string): Promise<void> {
  const amount = record.action.amount !== undefined ? ` ${formatMoney(record.action.amount, record.action.currency ?? 'USD')}` : '';
  const why = record.decision?.hits.map((h) => h.message).join(' ') ?? '';
  const title = `Say-so needed: ${record.action.kind}${amount}`;
  console.log(`[guard] ${record.id} ${title}. ${why} -> ${approveUrl}`);

  const topic = process.env.SAYSO_NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`${process.env.SAYSO_NTFY_URL ?? 'https://ntfy.sh'}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: title, Click: approveUrl, Tags: 'raised_hand', Priority: 'high' },
      body: `${record.action.reason}\n${why}`.slice(0, 1_000),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error('[guard] owner push failed', err);
  }
}
