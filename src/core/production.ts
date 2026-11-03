// The made-to-order board: every piece the owner still has to make, from a paid order with made-to-order
// items or an invoiced commission. PayPal decides when making can start: until the buyer pays (or pays
// the deposit), the making phase is blocked. The owner, or their agent, can move a plan; payments are
// facts from PayPal and can't be moved.

import { findVariant, type Catalog } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import type { Guard } from './guard/engine.ts';
import type { GuardRecord } from './guard/types.ts';
import type { Invoicing } from './invoicing.ts';
import { formatMoney, toMinor } from './money.ts';
import type { InvoiceParams } from './paypal/invoices.ts';
import type { CartStore, StoredCart } from './stores.ts';

/** A day, "2026-11-12". Plans are made in whole days. */
export type Day = string;

export interface Plan {
  start: Day;
  end: Day;
}

export interface PlanStore {
  /** The owner's own plans for a shop, by job id. */
  list(shopId: string): Promise<Record<string, Plan>>;
  put(shopId: string, jobId: string, plan: Plan): Promise<void>;
}

export type PaymentState = 'waiting' | 'deposit' | 'paid';

export interface ProductionJob {
  /** "order:<cart id>:<variant id>" or "invoice:<say-so id>". */
  id: string;
  kind: 'order' | 'invoice';
  title: string;
  customer?: string;
  /** What the owner and buyer call it: the order number or the invoice number. */
  reference: string;
  payment: { state: PaymentState; amount: string; since: Day; paidOn?: Day };
  /** Days of work, when known: the variant's lead time, or what the invoice promised. */
  makeDays?: number;
  /** When it is being made. Absent for a commission with no promised lead time until someone plans it. */
  making?: Plan & { by: 'payment' | 'owner' };
  /** Making can't really start: nothing has been paid yet. */
  blocked: boolean;
}

export interface ProductionDeps {
  carts: CartStore;
  catalogs: { byShopId(shopId: string): Promise<Catalog | undefined> };
  guard: Guard;
  invoicing: Invoicing;
  plans: PlanStore;
  today?: () => Day;
}

/** The longest plan anyone can set, as a guard against typos (2062 instead of 2026). */
const MAX_PLAN_DAYS = 365;
const ORDERS_SCANNED = 200;

export class Production {
  private readonly deps: ProductionDeps;

  constructor(deps: ProductionDeps) {
    this.deps = deps;
  }

  /** Everything still to make, waiting-for-payment first, then by when it has to be done. */
  async jobs(shopId: string): Promise<ProductionJob[]> {
    const [catalog, carts, invoices, plans] = await Promise.all([
      this.deps.catalogs.byShopId(shopId),
      this.deps.carts.listByShop(shopId, ORDERS_SCANNED),
      this.deps.guard.list(shopId, { kind: 'invoice.send', status: ['verified', 'unverified'] }),
      this.deps.plans.list(shopId),
    ]);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    const today = this.today();
    const jobs = [
      ...carts.flatMap((cart) => orderJobs(cart, catalog, today)),
      ...(await Promise.all(invoices.map((record) => this.invoiceJob(record, today)))),
    ];
    return jobs
      .map((job) => withPlan(job, plans[job.id], today))
      .sort((a, b) => Number(b.blocked) - Number(a.blocked) || (a.making?.end ?? '9999').localeCompare(b.making?.end ?? '9999'));
  }

  /** Move or set when a job is made. Owner or agent; nothing about money changes. */
  async plan(shopId: string, jobId: string, plan: Plan): Promise<ProductionJob> {
    const days = daysBetween(plan.start, plan.end);
    if (!isDay(plan.start) || !isDay(plan.end) || days < 0) throw new HttpError(400, 'Plans need a start and an end date (YYYY-MM-DD), the end not before the start');
    if (days > MAX_PLAN_DAYS) throw new HttpError(400, `A plan can be at most ${MAX_PLAN_DAYS} days long`);
    const job = (await this.jobs(shopId)).find((j) => j.id === jobId);
    if (!job) throw notFound(`Job ${jobId}`);
    await this.deps.plans.put(shopId, jobId, plan);
    return withPlan(job, plan, this.today());
  }

  private async invoiceJob(record: GuardRecord, today: Day): Promise<ProductionJob> {
    const p = record.action.params as unknown as InvoiceParams;
    const live = await this.deps.invoicing.liveStatus(record);
    const state: PaymentState = live?.status === 'PAID' || live?.status === 'MARKED_AS_PAID' ? 'paid' : live?.status === 'PARTIALLY_PAID' ? 'deposit' : 'waiting';
    const paidOn = live?.payments?.transactions?.[0]?.payment_date?.slice(0, 10) ?? (state === 'waiting' ? undefined : today);
    return {
      id: `invoice:${record.id}`,
      kind: 'invoice',
      title: p.items.map((i) => (i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name)).join(', '),
      customer: p.to.name ?? p.to.email,
      reference: live?.detail.invoice_number ? `Invoice ${live.detail.invoice_number}` : record.id,
      payment: { state, amount: formatMoney(record.action.amount ?? 0, p.currency), since: record.createdAt.slice(0, 10), paidOn },
      makeDays: p.makeDays,
      blocked: state === 'waiting',
    };
  }

  private today(): Day {
    return this.deps.today?.() ?? new Date().toISOString().slice(0, 10);
  }
}

/** One job per made-to-order line of a placed order that still stands. */
function orderJobs(cart: StoredCart, catalog: Catalog, today: Day): ProductionJob[] {
  if (cart.cart.status !== 'COMPLETED' || cart.released) return [];
  const paid = Boolean(cart.captureId);
  const currency = cart.cart.totals?.total.currency_code ?? catalog.shop.currency;
  return cart.cart.items.flatMap((item) => {
    const variant = item.variant_id ? findVariant(catalog, item.variant_id)?.variant : undefined;
    if (variant?.madeToOrderDays === undefined) return [];
    return [
      {
        id: `order:${cart.id}:${variant.id}`,
        kind: 'order' as const,
        title: `${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name ?? variant.title}`,
        customer: cart.cart.customer?.email_address,
        reference: cart.merchantOrderNumber ?? cart.id,
        payment: {
          state: paid ? ('paid' as const) : ('waiting' as const),
          amount: item.price ? formatMoney(toMinor(item.price) * item.quantity, currency) : '-',
          since: cart.createdAt.slice(0, 10),
          paidOn: paid ? (cart.paidAt ?? today).slice(0, 10) : undefined,
        },
        makeDays: variant.madeToOrderDays,
        blocked: !paid,
      },
    ];
  });
}

/**
 * The owner's plan wins. Otherwise work starts the day after the money arrives (projected from today
 * while it hasn't) and takes the promised number of days.
 */
function withPlan(job: ProductionJob, plan: Plan | undefined, today: Day): ProductionJob {
  if (plan) return { ...job, making: { ...plan, by: 'owner' } };
  if (job.makeDays === undefined) return { ...job, making: undefined };
  const start = addDays(job.payment.paidOn ?? today, 1);
  return { ...job, making: { start, end: addDays(start, job.makeDays - 1), by: 'payment' } };
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDays(day: Day, days: number): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(start: Day, end: Day): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export class MemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, Record<string, Plan>>();
  async list(shopId: string) {
    return { ...this.plans.get(shopId) };
  }
  async put(shopId: string, jobId: string, plan: Plan) {
    this.plans.set(shopId, { ...this.plans.get(shopId), [jobId]: { ...plan } });
  }
}
