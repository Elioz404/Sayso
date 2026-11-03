// Saved PayPal for a buyer's own assistant ("wallets"). The buyer approves once in PayPal and picks
// their limits; after that their assistant pays on its own inside those limits, through the buyer's
// own Guard. Anything over a limit falls back to a normal PayPal approval for that one order.
//
// The assistant holds a wallet key (sk_wallet_...), never the PayPal token. Limits are chosen by the
// person on Sayso's page before they approve in PayPal, so they are bound to that approval: no tool
// can raise them.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Commerce } from './commerce.ts';
import { HttpError, notFound } from './errors.ts';
import type { Guard } from './guard/engine.ts';
import type { Policy } from './guard/policy.ts';
import type { PolicyStore } from './guard/policy-store.ts';
import type { Actor, Executor, GuardRecord } from './guard/types.ts';
import type { Links } from './links.ts';
import { DEFAULT_CURRENCY, formatMoney, majorUnits, parseAmount, toMinor } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { getAuthorization } from './paypal/orders.ts';
import { approveLink, createPaymentToken, createSetupToken, deletePaymentToken, getSetupToken } from './paypal/vault.ts';

export interface WalletLimits {
  /** Largest single purchase the assistant may make alone, in minor units. */
  perOrder: number;
  /** Most it may spend alone in 24 hours. */
  daily: number;
  currency: string;
}

export interface Wallet {
  id: string;
  hash: string;
  hint: string;
  /** What the buyer calls the assistant, e.g. "chatgpt". */
  label: string;
  status: 'new' | 'awaiting_paypal' | 'connected' | 'disconnected';
  limits: WalletLimits;
  setupTokenId?: string;
  paymentTokenId?: string;
  paypalCustomerId?: string;
  payerEmail?: string;
  createdAt: string;
  connectedAt?: string;
}

export interface WalletStore {
  put(wallet: Wallet): Promise<void>;
  get(id: string): Promise<Wallet | undefined>;
  /** Finds a wallet by any of its keys: the assistant's, or the one in the buyer's personal URL. */
  byHash(hash: string): Promise<Wallet | undefined>;
  addKey(walletId: string, hash: string): Promise<void>;
  /** Forget every extra key of a wallet (its personal URLs). */
  removeKeys(walletId: string): Promise<void>;
}

/** What a new wallet starts with, before the person picks their own limits. */
export function defaultLimits(currency = DEFAULT_CURRENCY): WalletLimits {
  return { perOrder: majorUnits(100, currency), daily: majorUnits(250, currency), currency };
}
/** The most a person can let an assistant spend alone, per order or per day, in whole currency units. */
const MAX_LIMIT_UNITS = 2_000;

export interface WalletsDeps {
  store: WalletStore;
  policies: PolicyStore;
  guard: Guard;
  commerce: Commerce;
  paypal: PayPalClient;
  links: Links;
}

export interface WalletPayment {
  /** paid: done. needs_approval: over a limit, so the buyer approves this one in PayPal. */
  outcome: 'paid' | 'authorized_waiting_for_shop' | 'needs_approval';
  /** The buyer's Guard record; absent when the wallet could not be used at all (another currency). */
  record?: GuardRecord;
  approvalUrl?: string;
}

const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex');

export class Wallets {
  private readonly deps: WalletsDeps;

  constructor(deps: WalletsDeps) {
    this.deps = deps;
  }

  /** A new wallet for an assistant. Returns the key once; the person finishes setup at `connectUrl`. */
  async create(label: string): Promise<{ wallet: Wallet; key: string; connectUrl: string }> {
    const key = `sk_wallet_${randomBytes(24).toString('base64url')}`;
    const wallet: Wallet = {
      id: `wal_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      hash: hashOf(key),
      hint: key.slice(-4),
      label: label.slice(0, 40) || 'assistant',
      status: 'new',
      limits: defaultLimits(),
      createdAt: new Date().toISOString(),
    };
    await this.deps.store.put(wallet);
    return { wallet, key, connectUrl: this.connectUrl(wallet) };
  }

  connectUrl(wallet: Wallet): string {
    return this.deps.links.wallet(wallet.id);
  }

  async fromKey(key: string | undefined): Promise<Wallet | undefined> {
    if (!key?.startsWith('sk_wallet_')) return undefined;
    return this.deps.store.byHash(hashOf(key));
  }

  async get(id: string): Promise<Wallet> {
    const wallet = await this.deps.store.get(id);
    if (!wallet) throw notFound('Wallet');
    return wallet;
  }

  /**
   * The person picked their limits on Sayso's page: save them and send the person to PayPal. The limits
   * are fixed now, before PayPal approval, and only a new approval can change them.
   */
  async startConnect(id: string, limits: { perOrder: string; daily: string }): Promise<string> {
    const wallet = await this.get(id);
    if (wallet.status === 'connected') throw new HttpError(409, 'This wallet is already connected. Disconnect it to start over.');
    const currency = wallet.limits.currency;
    const picked: WalletLimits = { perOrder: parseLimit(limits.perOrder, currency), daily: parseLimit(limits.daily, currency), currency };
    if (picked.daily < picked.perOrder) throw new HttpError(400, 'The daily limit must be at least the per-order limit');

    const token = await createSetupToken(
      this.deps.paypal,
      {
        description: `${wallet.label} pays small shops on Sayso for you: up to ${formatMoney(picked.perOrder, currency)} an order, ${formatMoney(picked.daily, currency)} a day`,
        brandName: 'Sayso',
        returnUrl: this.deps.links.walletReturn(wallet.id),
        cancelUrl: this.deps.links.walletCancelled(wallet.id),
      },
      // A fresh key per attempt: a reconnect must get a new setup token, not PayPal's replay of the last one.
      `${wallet.id}-setup-${randomBytes(6).toString('hex')}`,
    );
    const link = approveLink(token);
    if (!link) throw new HttpError(502, 'PayPal did not return an approval link');
    await this.deps.store.put({ ...wallet, status: 'awaiting_paypal', limits: picked, setupTokenId: token.id });
    await this.deps.policies.put(walletPolicy(wallet.id, picked));
    return link;
  }

  /**
   * Back from PayPal: turn the approved setup token into a payment token. Also issues the key for the
   * buyer's personal shopping URL, returned once. Calling it again returns no new key.
   */
  async finishConnect(id: string): Promise<{ wallet: Wallet; connectorKey?: string }> {
    const wallet = await this.get(id);
    if (wallet.status === 'connected') return { wallet };
    if (wallet.status !== 'awaiting_paypal' || !wallet.setupTokenId) throw new HttpError(409, 'Start from the wallet page');
    const setup = await getSetupToken(this.deps.paypal, wallet.setupTokenId);
    if (setup.status !== 'APPROVED') throw new HttpError(409, `PayPal says this approval is ${setup.status.toLowerCase().replace(/_/g, ' ')}`);
    const token = await createPaymentToken(this.deps.paypal, wallet.setupTokenId, `${wallet.setupTokenId}-token`); // one per approval, safe to retry
    const connected: Wallet = {
      ...wallet,
      status: 'connected',
      paymentTokenId: token.id,
      paypalCustomerId: token.customer?.id,
      payerEmail: token.payment_source?.paypal?.email_address,
      connectedAt: new Date().toISOString(),
    };
    await this.deps.store.put(connected);
    const connectorKey = `sk_wallet_${randomBytes(24).toString('base64url')}`;
    await this.deps.store.addKey(wallet.id, hashOf(connectorKey));
    return { wallet: connected, connectorKey };
  }

  /** The URL a buyer adds to ChatGPT or any MCP client: every shop, plus their saved PayPal. */
  personalUrl(key: string): string {
    return this.deps.links.shoppingMcpFor(key);
  }

  async disconnect(id: string): Promise<Wallet> {
    const wallet = await this.get(id);
    if (wallet.paymentTokenId) await deletePaymentToken(this.deps.paypal, wallet.paymentTokenId).catch(() => undefined);
    // Every key issued so far stops working, so a leaked URL can't spend again after a later reconnect.
    // The hash is rotated to one no key produces; reconnecting issues fresh keys.
    const off: Wallet = { ...wallet, status: 'disconnected', paymentTokenId: undefined, hash: hashOf(randomBytes(24).toString('base64url')) };
    await this.deps.store.removeKeys(wallet.id);
    await this.deps.store.put(off);
    return off;
  }

  /**
   * The assistant pays for a cart. The buyer's Guard decides first (their limits); inside them PayPal
   * authorizes the saved account and the shop's Guard captures. Over a limit, nothing is charged and
   * the buyer gets the cart's normal PayPal link to approve this one order.
   */
  async pay(wallet: Wallet, cartId: string, channel: string): Promise<WalletPayment> {
    if (wallet.status !== 'connected' || !wallet.paymentTokenId) throw new HttpError(409, `PayPal isn't connected yet. The buyer finishes at ${this.connectUrl(wallet)}`);
    const cart = await this.deps.commerce.getCart(cartId);
    if (cart.status === 'COMPLETED') throw new HttpError(422, 'This cart is already paid');
    if (!cart.totals || !cart.payment_method?.approval_url) throw new HttpError(422, 'Fix the cart first: it has no payable total yet');
    const total = cart.totals.total;
    if (total.currency_code !== wallet.limits.currency) {
      return { outcome: 'needs_approval', approvalUrl: cart.payment_method.approval_url };
    }

    const actor: Actor = { type: 'agent', id: `buyer-agent:${channel}`, side: 'buyer' };
    const record = await this.deps.guard.submit(
      {
        kind: 'checkout.create',
        actor,
        ownerId: wallet.id,
        amount: toMinor(total),
        currency: total.currency_code,
        resourceId: cartId,
        reason: `Pay for ${cart.items.map((i) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', ')}`.slice(0, 300),
        params: { cartId, walletId: wallet.id },
      },
      // The buyer has no approvals queue: over a limit, their say-so is approving this order in PayPal.
      { notify: false },
    );

    if (record.status === 'pending_approval') {
      const handedOff = await this.deps.guard.reject(record.id, 'sayso', 'Over the limits: sent to the buyer to approve this order in PayPal.');
      return { outcome: 'needs_approval', record: handedOff, approvalUrl: cart.payment_method.approval_url };
    }
    if (record.status !== 'verified') {
      const why = record.decision?.hits.map((h) => h.message).join(' ') || record.verification?.detail || 'PayPal did not accept the saved account';
      throw new HttpError(422, `Not paid: ${why}`);
    }
    const done = await this.deps.commerce.settleSaved(cartId, wallet.payerEmail);
    return { outcome: done.payment_confirmation?.payment_status === 'CAPTURED' ? 'paid' : 'authorized_waiting_for_shop', record };
  }
}

/** The buyer's limits as Guard rules: over them, ask the buyer; never the same cart twice in 10 minutes. */
export function walletPolicy(walletId: string, limits: WalletLimits): Policy {
  return {
    ownerId: walletId,
    currency: limits.currency,
    source: `My assistant can spend up to ${formatMoney(limits.perOrder, limits.currency)} an order and ${formatMoney(limits.daily, limits.currency)} a day; ask me above that.`,
    rules: [
      { id: 'wallet-order', type: 'max_amount', kinds: ['checkout.create'], limit: limits.perOrder, then: 'require_approval' },
      { id: 'wallet-daily', type: 'daily_total', kinds: ['checkout.create'], limit: limits.daily, then: 'require_approval' },
      { id: 'wallet-dup', type: 'no_duplicates', kinds: ['checkout.create'], windowMinutes: 10 },
    ],
  };
}

/** Guard executor for a buyer's saved-PayPal purchase: simulate the cart, authorize, read the hold back. */
export function walletCheckoutExecutor(deps: { commerce: Commerce; store: WalletStore; paypal: PayPalClient }): Executor {
  return {
    async simulate(action) {
      const cart = await deps.commerce.getCart(String(action.resourceId));
      const wallet = await deps.store.get(action.ownerId);
      const blockers: string[] = [];
      if (cart.status === 'COMPLETED') blockers.push('This cart is already paid.');
      if (!cart.totals || !cart.payment_method?.approval_url) blockers.push('The cart has no payable total.');
      if (wallet?.status !== 'connected') blockers.push('PayPal is not connected for this assistant.');
      const total = cart.totals?.total;
      return {
        ok: blockers.length === 0,
        blockers,
        amount: total ? toMinor(total) : undefined,
        effects: [`Pay ${total ? formatMoney(toMinor(total), total.currency_code) : '-'} with the saved PayPal account${wallet?.payerEmail ? ` (${wallet.payerEmail})` : ''}.`],
      };
    },
    async execute(action) {
      const wallet = await deps.store.get(action.ownerId);
      if (!wallet?.paymentTokenId) throw new Error('PayPal is not connected');
      const result = await deps.commerce.authorizeSaved(String(action.resourceId), wallet.paymentTokenId);
      return { order_id: result.orderId, authorization_id: result.authorizationId, amount: result.amount };
    },
    async verify(action, result) {
      const auth = await getAuthorization(deps.paypal, String(result.authorization_id));
      const ok = auth.status === 'CREATED' && toMinor(auth.amount) === action.amount;
      return { ok, detail: `PayPal holds ${formatMoney(toMinor(auth.amount), auth.amount.currency_code)} (${auth.status.toLowerCase()}).` };
    },
  };
}

function parseLimit(value: string, currency: string): number {
  const minor = parseAmount(value, currency);
  const max = majorUnits(MAX_LIMIT_UNITS, currency);
  if (minor === undefined) throw new HttpError(400, 'Limits must be amounts like 100 or 49.50');
  if (minor <= 0 || minor > max) throw new HttpError(400, `Limits must be more than zero and at most ${formatMoney(max, currency)}`);
  return minor;
}

export class MemoryWalletStore implements WalletStore {
  private readonly wallets = new Map<string, Wallet>();
  private readonly keys = new Map<string, string>();
  async put(wallet: Wallet) {
    this.wallets.set(wallet.id, structuredClone(wallet));
  }
  async get(id: string) {
    const w = this.wallets.get(id);
    return w && structuredClone(w);
  }
  async byHash(hash: string) {
    const w = [...this.wallets.values()].find((x) => x.hash === hash) ?? this.wallets.get(this.keys.get(hash) ?? '');
    return w && structuredClone(w);
  }
  async addKey(walletId: string, hash: string) {
    this.keys.set(hash, walletId);
  }
  async removeKeys(walletId: string) {
    for (const [hash, id] of this.keys) if (id === walletId) this.keys.delete(hash);
  }
}
