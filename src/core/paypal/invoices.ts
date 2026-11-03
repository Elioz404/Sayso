// PayPal Invoicing v2, for custom orders agreed in a DM: a commission, a made-to-order piece, a deposit.
// Sending an invoice is a Guard action (`invoice.send`), so the executor below simulates it, sends it
// with the record's idempotency key, and reads it back from PayPal before it counts.

import type { Executor } from '../guard/types.ts';
import { formatMoney, toMoney } from '../money.ts';
import type { PayPalClient } from './client.ts';

export interface InvoiceLine {
  name: string;
  quantity: number;
  /** Unit price in minor units of the invoice currency. */
  unitAmount: number;
}

/** What `invoice.send` carries in `action.params`. */
export interface InvoiceParams {
  to: { email: string; name?: string };
  items: InvoiceLine[];
  currency: string;
  note?: string;
  /** 0 = due on receipt. */
  dueDays: number;
  /** Lets the buyer pay this much first, e.g. a deposit before work starts. */
  depositMinor?: number;
  shopName: string;
  [key: string]: unknown;
}

export interface Invoice {
  id: string;
  status: string;
  detail: { invoice_number?: string; currency_code: string; metadata?: { recipient_view_url?: string } };
  amount?: { value: string; currency_code: string };
  due_amount?: { value: string; currency_code: string };
}

const TERMS: Record<number, string> = { 0: 'DUE_ON_RECEIPT', 10: 'NET_10', 15: 'NET_15', 30: 'NET_30' };
const SENT = new Set(['SENT', 'UNPAID', 'SCHEDULED', 'PARTIALLY_PAID', 'PAID', 'MARKED_AS_PAID', 'PAYMENT_PENDING']);

export function invoiceTotal(params: Pick<InvoiceParams, 'items'>): number {
  return params.items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0);
}

export const getInvoice = (client: PayPalClient, id: string) => client.get<Invoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);

export function invoiceExecutor(client: PayPalClient): Executor {
  const params = (p: Record<string, unknown> | undefined) => p as unknown as InvoiceParams;
  return {
    async simulate(action) {
      const p = params(action.params);
      const total = invoiceTotal(p);
      const blockers: string[] = [];
      if (!p?.to?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to.email)) blockers.push('The invoice needs a valid email address for the buyer.');
      if (!p?.items?.length || total <= 0) blockers.push('The invoice needs at least one item with a price.');
      if (p?.depositMinor !== undefined && (p.depositMinor <= 0 || p.depositMinor >= total)) blockers.push('A deposit must be more than zero and less than the total.');
      const lines = (p?.items ?? []).map((i) => `${i.quantity}x ${i.name} at ${formatMoney(i.unitAmount, p.currency)}`).join(', ');
      return {
        ok: blockers.length === 0,
        blockers,
        effects: [
          `Send ${p?.to?.email ?? 'the buyer'} a PayPal invoice for ${formatMoney(total, p?.currency ?? 'USD')}: ${lines}.`,
          p?.depositMinor ? `They can pay a ${formatMoney(p.depositMinor, p.currency)} deposit first.` : p?.dueDays ? `Due in ${p.dueDays} days.` : 'Due on receipt.',
        ],
      };
    },
    async execute(action, key) {
      const p = params(action.params);
      const draft = await client.post<Invoice>(
        '/v2/invoicing/invoices',
        {
          detail: {
            currency_code: p.currency,
            note: p.note?.slice(0, 4000),
            memo: `Sent by ${action.actor.id} through Sayso`,
            payment_term: { term_type: TERMS[p.dueDays] ?? 'DUE_ON_RECEIPT' },
          },
          primary_recipients: [{ billing_info: { email_address: p.to.email, ...(p.to.name ? { name: { full_name: p.to.name.slice(0, 120) } } : {}) } }],
          items: p.items.map((i) => ({ name: i.name.slice(0, 200), quantity: String(i.quantity), unit_amount: toMoney(i.unitAmount, p.currency) })),
          configuration: {
            allow_tip: false,
            ...(p.depositMinor ? { partial_payment: { allow_partial_payment: true, minimum_amount_due: toMoney(p.depositMinor, p.currency) } } : {}),
          },
        },
        `${key}-draft`,
      );
      await client.post(`/v2/invoicing/invoices/${draft.id}/send`, { send_to_invoicer: false, send_to_recipient: true, subject: `Invoice from ${p.shopName}`.slice(0, 120) }, `${key}-send`);
      const sent = await getInvoice(client, draft.id);
      return {
        invoice_id: sent.id,
        number: sent.detail.invoice_number,
        status: sent.status,
        payer_url: sent.detail.metadata?.recipient_view_url,
      };
    },
    async verify(_action, result) {
      const invoice = await getInvoice(client, String(result.invoice_id));
      const ok = SENT.has(invoice.status);
      return { ok, detail: `Invoice ${invoice.detail.invoice_number ?? invoice.id} is ${invoice.status.toLowerCase().replace(/_/g, ' ')} in PayPal.`, observed: { status: invoice.status } };
    },
  };
}
