// The made-to-order board: every piece the owner still has to make, from a placed order with
// made-to-order items or an invoiced commission. PayPal decides when making can start: until the buyer
// pays (or pays the deposit), and until the owner accepts an order held for their OK, the work is
// blocked. The owner, or their agent, plans the work and marks it made; payments are facts from PayPal
// and can't be moved. Cancelled, refunded or released work leaves the board on its own.

import { mapLimit } from './concurrency.ts';
import { findVariant, type Catalog } from './catalog.ts';
import { addDays, dayOf, daysBetween, isDay, type Day } from './days.ts';
import { HttpError, notFound } from './errors.ts';
import type { Guard } from './guard/engine.ts';
import type { GuardRecord } from './guard/types.ts';
import type { Invoicing } from './invoicing.ts';
import { formatMoney, toMinor } from './money.ts';
import type { Invoice, InvoiceParams } from './paypal/invoices.ts';
import type { CartStore, StoredCart } from './stores.ts';

export type { Day } from './days.ts';

export interface Plan {
  start: Day;
  end: Day;
}

/** What the owner decided about a job: when to make it, and whether it's made. */
export interface JobNotes {
  plan?: Plan;
  madeOn?: Day;
}

export interface JobStore {
  /** Notes for a shop's jobs, by job id. */
  list(shopId: string): Promise<Record<string, JobNotes>>;
  /** Merge `notes` into the job's existing notes. */
  update(shopId: string, jobId: string, notes: JobNotes): Promise<void>;
}

/**
 * waiting: the buyer hasn't paid. held: the buyer approved, the order waits for the owner's OK.
 * deposit: the deposit is in. paid: paid in full. unknown: PayPal couldn't be read just now.
 */
export type PaymentState = 'waiting' | 'held' | 'deposit' | 'paid' | 'unknown';

export interface ProductionJob {
  /** "order:<cart id>:<line>" or "invoice:<say-so id>". */
  id: string;
  kind: 'order' | 'invoice';
  title: string;
  customer?: string;
  /** What the owner and buyer call it: the order number or the invoice number. */
  reference: string;
  payment: { state: PaymentState; amount: string; since: Day; paidOn?: Day };
  /** Days of work, when known: the lead time at the time of the order, or what the invoice promised. */
  makeDays?: number;
  /** When it is being made. Absent for a commission with no promised lead time until someone plans it. */
  making?: Plan & { by: 'payment' | 'owner' };
  /** Why work can't start yet, if it can't. */
  blockedBy?: 'payment' | 'owner';
}

export interface ProductionDeps {
  carts: CartStore;
  catalogs: { byShopId(shopId: string): Promise<Catalog | undefined> };
  guard: Guard;
  invoicing: Invoicing;
  jobs: JobStore;
  today?: () => Day;
}

/** The longest plan anyone can set, as a guard against typos (2062 instead of 2026). */
const MAX_PLAN_DAYS = 365;
/** How many placed orders and sent invoices the board looks at, newest first. */
const SCANNED = 100;
/** Refunds read for those orders (a few per order at most). */
const REFUNDS_READ = 2_000;
const INVOICE_STATE: Record<string, PaymentState | 'gone'> = {
  PAID: 'paid',
  MARKED_AS_PAID: 'paid',
  PARTIALLY_PAID: 'deposit',
  SENT: 'waiting',
  UNPAID: 'waiting',
  SCHEDULED: 'waiting',
  PAYMENT_PENDING: 'waiting',
  CANCELLED: 'gone',
  REFUNDED: 'gone',
  MARKED_AS_REFUNDED: 'gone',
  PARTIALLY_REFUNDED: 'gone',
};

export class Production {
  private readonly deps: ProductionDeps;

  constructor(deps: ProductionDeps) {
    this.deps = deps;
  }

  /** Today, as the board counts days. Pages and the scheduler use this one. */
  today(): Day {
    return this.deps.today?.() ?? dayOf();
  }

  /** Everything still to make: blocked work first, then by when it has to be done. */
  async jobs(shopId: string): Promise<ProductionJob[]> {
    const [catalog, carts, invoices, notes] = await Promise.all([
      this.catalog(shopId),
      this.deps.carts.listPlaced(shopId, { limit: SCANNED }),
      this.deps.guard.list(shopId, { kind: 'invoice.send', status: ['verified', 'unverified'], limit: SCANNED }),
      this.deps.jobs.list(shopId),
    ]);
    // Refunds for the orders on the board only, however many other refunds the shop has.
    const refunds = carts.length ? await this.deps.guard.list(shopId, { kind: 'refund.create', status: 'verified', cartIds: carts.map((c) => c.id), limit: REFUNDS_READ }) : [];
    const jobs = [
      ...carts.flatMap((cart) => orderJobs(cart, catalog, refunds)),
      // Each invoice's status is read from PayPal: a few at a time, not a hundred at once.
      ...(await mapLimit(invoices, 5, (record) => this.invoiceJob(record))).flatMap((job) => (job ? [job] : [])),
    ];
    return jobs
      .filter((job) => !notes[job.id]?.madeOn)
      .map((job) => withPlan(job, notes[job.id]?.plan, this.today()))
      .sort((a, b) => Number(Boolean(b.blockedBy)) - Number(Boolean(a.blockedBy)) || (a.making?.end ?? '9999').localeCompare(b.making?.end ?? '9999'));
  }

  /** Set when a job is made. Owner or agent; nothing about money changes. */
  async plan(shopId: string, jobId: string, plan: Plan): Promise<ProductionJob> {
    if (!isDay(plan.start) || !isDay(plan.end) || daysBetween(plan.start, plan.end) < 0) {
      throw new HttpError(400, 'Plans need a real start and end date (YYYY-MM-DD), the end not before the start');
    }
    if (daysBetween(plan.start, plan.end) > MAX_PLAN_DAYS) throw new HttpError(400, `A plan can be at most ${MAX_PLAN_DAYS} days long`);
    const job = await this.job(shopId, jobId);
    await this.deps.jobs.update(shopId, jobId, { plan });
    return withPlan(job, plan, this.today());
  }

  /** The piece is made: it leaves the board. Shipping it is the order's own business (tracking). */
  async finish(shopId: string, jobId: string): Promise<{ id: string; madeOn: Day }> {
    await this.job(shopId, jobId);
    const madeOn = this.today();
    await this.deps.jobs.update(shopId, jobId, { madeOn });
    return { id: jobId, madeOn };
  }

  /** One job by id, read on its own rather than by building the whole board. */
  private async job(shopId: string, jobId: string): Promise<ProductionJob> {
    const [kind, ref, line] = jobId.split(':');
    let job: ProductionJob | undefined;
    if (kind === 'invoice' && ref) {
      const record = await this.deps.guard.get(ref);
      if (record?.action.ownerId === shopId && record.action.kind === 'invoice.send') job = await this.invoiceJob(record);
    } else if (kind === 'order' && ref && line) {
      const cart = await this.deps.carts.get(ref);
      if (cart?.shopId === shopId) {
        const [catalog, refunds] = await Promise.all([this.catalog(shopId), this.deps.guard.list(shopId, { kind: 'refund.create', status: 'verified', cartId: ref, limit: REFUNDS_READ })]);
        job = orderJobs(cart, catalog, refunds).find((j) => j.id === jobId);
      }
    }
    if (!job) throw notFound(`Job ${jobId}`);
    return job;
  }

  /** A sent invoice as a job, or nothing once it is cancelled or refunded. */
  private async invoiceJob(record: GuardRecord): Promise<ProductionJob | undefined> {
    const p = record.action.params as unknown as InvoiceParams;
    const live = await this.deps.invoicing.liveStatus(record);
    const state = live ? (INVOICE_STATE[live.status] ?? 'waiting') : 'unknown';
    if (state === 'gone') return undefined;
    return {
      id: `invoice:${record.id}`,
      kind: 'invoice',
      title: p.items.map((i) => (i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name)).join(', '),
      customer: p.to.name ?? p.to.email,
      reference: live?.detail.invoice_number ? `Invoice ${live.detail.invoice_number}` : record.id,
      payment: { state, amount: formatMoney(record.action.amount ?? 0, p.currency), since: dayOf(record.createdAt), paidOn: paidOn(state, live, record) },
      makeDays: p.makeDays,
      blockedBy: state === 'waiting' ? 'payment' : undefined,
    };
  }

  private async catalog(shopId: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    return catalog;
  }
}

/** When an invoice's money arrived: PayPal's payment date, or failing that when it was sent. */
function paidOn(state: PaymentState, live: Invoice | undefined, record: GuardRecord): Day | undefined {
  if (state !== 'paid' && state !== 'deposit') return undefined;
  const date = live?.payments?.transactions?.[0]?.payment_date;
  return date && isDay(date.slice(0, 10)) ? date.slice(0, 10) : dayOf(record.createdAt);
}

/** One job per made-to-order line of a placed order that still stands (not fully refunded). */
function orderJobs(cart: StoredCart, catalog: Catalog, refunds: readonly GuardRecord[]): ProductionJob[] {
  const total = cart.cart.totals ? toMinor(cart.cart.totals.total) : 0;
  const refunded = refunds.filter((r) => r.action.params?.cartId === cart.id).reduce((sum, r) => sum + (r.action.amount ?? 0), 0);
  if (cart.released || (total > 0 && refunded >= total)) return [];
  const currency = cart.cart.totals?.total.currency_code ?? catalog.shop.currency;
  const state: PaymentState = cart.captureId ? 'paid' : 'held';
  return cart.cart.items.flatMap((item, line) => {
    // The lead time promised when the order was placed; older orders fall back to the catalog's.
    const makeDays = cart.makeDays?.[line] ?? (item.variant_id ? findVariant(catalog, item.variant_id)?.variant.madeToOrderDays : undefined);
    if (makeDays === undefined || makeDays === null) return [];
    return [
      {
        id: `order:${cart.id}:${line}`,
        kind: 'order' as const,
        title: `${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name ?? item.variant_id}`,
        customer: cart.cart.customer?.email_address,
        reference: cart.merchantOrderNumber ?? cart.id,
        payment: {
          state,
          amount: item.price ? formatMoney(toMinor(item.price) * item.quantity, currency) : '-',
          since: dayOf(cart.createdAt),
          paidOn: state === 'paid' ? dayOf(cart.paidAt ?? cart.placedAt ?? cart.createdAt) : undefined,
        },
        makeDays,
        blockedBy: state === 'held' ? ('owner' as const) : undefined,
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

export class MemoryJobStore implements JobStore {
  private readonly notes = new Map<string, Record<string, JobNotes>>();
  async list(shopId: string) {
    return structuredClone(this.notes.get(shopId) ?? {});
  }
  async update(shopId: string, jobId: string, notes: JobNotes) {
    const shop = this.notes.get(shopId) ?? {};
    shop[jobId] = { ...shop[jobId], ...structuredClone(notes) };
    this.notes.set(shopId, shop);
  }
}
