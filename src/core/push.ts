// Notifications on the owner's phone (Web Push): when an agent's request waits for their say-so, and
// when a new order is paid. Each subscription is one browser the owner turned notifications on in,
// for one shop. The message is end-to-end encrypted to that browser, so the push service carries it
// without being able to read it; still, it never includes buyer details.

import { createHash } from 'node:crypto';
import { HttpError } from './errors.ts';
import { ACTIONS, type GuardRecord } from './guard/types.ts';
import type { Links } from './links.ts';
import { DEFAULT_CURRENCY, formatMoney } from './money.ts';

export interface PushSubscriptionRecord {
  id: string;
  shopId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The device, as the browser describes itself: "iPhone", "Android", "Mac". */
  label: string;
  createdAt: string;
}

export interface PushStore {
  list(shopId: string): Promise<PushSubscriptionRecord[]>;
  put(subscription: PushSubscriptionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPushStore implements PushStore {
  private readonly subs = new Map<string, PushSubscriptionRecord>();
  async list(shopId: string) {
    return [...this.subs.values()].filter((s) => s.shopId === shopId).map((s) => structuredClone(s));
  }
  async put(subscription: PushSubscriptionRecord) {
    this.subs.set(subscription.id, structuredClone(subscription));
  }
  async remove(id: string) {
    this.subs.delete(id);
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification opens. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
}

/** Delivers one message. "gone" means the browser unsubscribed: forget it. */
export type PushSender = (subscription: PushSubscriptionRecord, message: PushMessage) => Promise<'sent' | 'gone'>;

const MAX_PER_SHOP = 10;
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)\//;

export class Push {
  private readonly store: PushStore;
  private readonly send?: PushSender;

  constructor(deps: { store: PushStore; send?: PushSender }) {
    this.store = deps.store;
    this.send = deps.send;
  }

  /** Whether this server can send pushes at all. */
  get enabled(): boolean {
    return Boolean(this.send);
  }

  list(shopId: string): Promise<PushSubscriptionRecord[]> {
    return this.store.list(shopId);
  }

  /** Remember a browser's subscription (what PushManager.subscribe() returned, as JSON). */
  async subscribe(shopId: string, raw: unknown, label: string): Promise<PushSubscriptionRecord> {
    const sub = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
    // Only real push services: the server would otherwise POST wherever a caller pointed it.
    if (!PUSH_HOSTS.test(endpoint) || !p256dh || !auth) throw new HttpError(400, 'That is not a push subscription from a browser');
    const id = idOf(endpoint);
    const existing = (await this.store.list(shopId)).filter((s) => s.id !== id);
    if (existing.length >= MAX_PER_SHOP) await this.store.remove(existing.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id);
    const record: PushSubscriptionRecord = { id, shopId, endpoint, keys: { p256dh, auth }, label: label.trim().slice(0, 40) || 'This device', createdAt: new Date().toISOString() };
    await this.store.put(record);
    return record;
  }

  async unsubscribe(shopId: string, endpoint: string): Promise<void> {
    const id = idOf(endpoint);
    if ((await this.store.list(shopId)).some((s) => s.id === id)) await this.store.remove(id);
  }

  /** Send to every device of the shop's owner. Failures are logged, never thrown: a push is best effort. */
  async notify(shopId: string, message: PushMessage): Promise<number> {
    if (!this.send) return 0;
    let sent = 0;
    for (const sub of await this.store.list(shopId)) {
      try {
        if ((await this.send(sub, message)) === 'gone') await this.store.remove(sub.id);
        else sent++;
      } catch (err) {
        console.error(`[push] ${sub.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return sent;
  }
}

/** "Your agent wants to refund $82.00", opening the say-so screen. */
export function sayNeededMessage(record: GuardRecord, links: Links): PushMessage {
  const { action } = record;
  const amount = action.amount !== undefined && action.kind !== 'policy.update' ? ` ${formatMoney(action.amount, action.currency ?? DEFAULT_CURRENCY)}` : '';
  const who = action.actor.type === 'agent' ? (action.actor.side === 'buyer' ? 'A buyer’s assistant' : 'Your agent') : 'Someone';
  return {
    title: `${ACTIONS[action.kind].label}${amount}?`,
    body: `${who} asked: “${action.reason.slice(0, 120)}”. Tap to decide.`,
    url: links.approve(record.id),
    tag: record.id,
  };
}

/** A paid order, opening the orders list. Undefined for anything else. */
export function paidOrderMessage(record: GuardRecord, links: Links): PushMessage | undefined {
  if (record.action.kind !== 'payment.capture' || record.status !== 'verified') return undefined;
  const amount = record.action.amount !== undefined ? formatMoney(record.action.amount, record.action.currency ?? DEFAULT_CURRENCY) : 'A new order';
  return { title: `New order: ${amount}`, body: 'Paid with PayPal and confirmed. Tap to see what to pack.', url: `${links.base}/owner/orders`, tag: `order-${record.id}` };
}

function idOf(endpoint: string): string {
  return `push_${createHash('sha256').update(endpoint).digest('hex').slice(0, 20)}`;
}
