// Invoices for custom orders (a commission, a made-to-order piece, a deposit first). Sending one is a
// Guard action: by default a large invoice, or a first one to someone who has never paid the shop,
// waits for the owner. Live status comes from PayPal, cached so a dashboard render is not N calls.

import { BoundedCache, mapLimit } from './concurrency.ts';
import { HttpError } from './errors.ts';
import type { Guard } from './guard/engine.ts';
import type { Actor, GuardRecord } from './guard/types.ts';
import { formatMoney, parseAmount } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { getInvoice, invoiceTotal, type Invoice, type InvoiceParams } from './paypal/invoices.ts';
import type { Shops } from './shops.ts';
import type { CartStore } from './stores.ts';

export interface InvoicingDeps {
  guard: Guard;
  carts: CartStore;
  shops: Shops;
  paypal: PayPalClient;
  /** How long a non-final PayPal status is reused before reading it again. Default one minute. */
  statusTtlMs?: number;
}

export interface InvoiceDraft {
  to: { email: string; name?: string };
  items: { name: string; price: string; quantity?: number }[];
  note?: string;
  dueDays?: number;
  deposit?: string;
  /** Days of work promised once the buyer pays (or pays the deposit). */
  makeDays?: number;
}

export interface InvoiceView {
  say_so_id: string;
  to: string;
  total: string;
  items: string;
  number?: string;
  status: string;
  payer_url?: string;
  at: string;
}

/** A client's invoices read to tell whether they have paid the shop before. */
const INVOICES_PER_CLIENT = 50;
const PAID = new Set(['PAID', 'MARKED_AS_PAID', 'PARTIALLY_PAID']);
/** No further change expected: cached for good. Anything else is re-read after STATUS_TTL_MS. */
const FINAL = new Set(['PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED', 'MARKED_AS_REFUNDED']);
const STATUS_TTL_MS = 60_000;
/** PayPal reads in flight at once when a page lists many invoices. */
const PAYPAL_READS = 5;

export class Invoicing {
  private readonly deps: InvoicingDeps;
  private readonly live = new BoundedCache<string, { invoice: Invoice; at: number }>(1_000);

  constructor(deps: InvoicingDeps) {
    this.deps = deps;
  }

  async send(shopId: string, draft: InvoiceDraft, actor: Actor): Promise<GuardRecord> {
    const { shop } = await this.deps.shops.get(shopId);
    const currency = shop.currency;
    const minor = (value: string, what: string) => {
      const amount = parseAmount(value, currency);
      if (!amount) throw new HttpError(400, `${what} must look like 62.00 (${currency})`);
      return amount;
    };
    const email = draft.to.email.trim().toLowerCase();
    const params: InvoiceParams = {
      to: { email, name: draft.to.name?.trim() || undefined },
      items: draft.items.map((i) => ({ name: i.name.trim(), quantity: i.quantity ?? 1, unitAmount: minor(i.price, 'Each price') })),
      currency,
      note: draft.note?.trim() || undefined,
      dueDays: draft.dueDays ?? 0,
      depositMinor: draft.deposit ? minor(draft.deposit, 'The deposit') : undefined,
      makeDays: draft.makeDays,
      shopName: shop.name,
      newCounterparty: !(await this.hasPaid(shopId, email)),
    };
    return this.deps.guard.submit({
      kind: 'invoice.send',
      actor,
      ownerId: shopId,
      amount: invoiceTotal(params),
      currency,
      counterparty: email,
      resourceId: email,
      reason: `Invoice ${email} for ${params.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}`.slice(0, 300),
      params,
    });
  }

  /** Invoices this shop sent or wants to send, newest first, with their live PayPal status. */
  async list(shopId: string, limit = 20): Promise<InvoiceView[]> {
    const records = await this.deps.guard.list(shopId, { kind: 'invoice.send', limit });
    return mapLimit(records, PAYPAL_READS, async (r) => {
        const p = r.action.params as unknown as InvoiceParams;
        const live = await this.liveStatus(r);
        return {
          say_so_id: r.id,
          to: p.to.email,
          total: formatMoney(r.action.amount ?? invoiceTotal(p), p.currency),
          items: p.items.map((i) => `${i.quantity}x ${i.name}`).join(', '),
          number: live?.detail.invoice_number ?? (r.result?.number as string | undefined),
          status: live ? live.status.toLowerCase().replace(/_/g, ' ') : r.status === 'pending_approval' ? 'waiting for the owner' : r.status,
          payer_url: live?.detail.metadata?.recipient_view_url ?? (r.result?.payer_url as string | undefined),
          at: r.createdAt,
        };
    });
  }

  /** Has this person paid the shop before: a paid order, or a paid invoice? */
  private async hasPaid(shopId: string, email: string): Promise<boolean> {
    if (await this.deps.carts.paidBy(shopId, email)) return true;
    const sent = await this.deps.guard.list(shopId, { kind: 'invoice.send', status: 'verified', counterparty: email, limit: INVOICES_PER_CLIENT });
    const statuses = await mapLimit(sent, PAYPAL_READS, async (record) => (await this.liveStatus(record))?.status ?? '');
    return statuses.some((status) => PAID.has(status));
  }

  /** The invoice as PayPal has it now (cached briefly), or undefined if it was never sent. */
  async liveStatus(record: GuardRecord): Promise<Invoice | undefined> {
    const id = typeof record.result?.invoice_id === 'string' ? record.result.invoice_id : undefined;
    if (!id) return undefined;
    const cached = this.live.get(id);
    if (cached && (FINAL.has(cached.invoice.status) || Date.now() - cached.at < (this.deps.statusTtlMs ?? STATUS_TTL_MS))) return cached.invoice;
    const invoice = await getInvoice(this.deps.paypal, id).catch(() => cached?.invoice);
    if (invoice) this.live.set(id, { invoice, at: Date.now() });
    return invoice;
  }
}
