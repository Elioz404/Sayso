// Who the buyer is, without a Sayso account. Signed in with PayPal: the signed, httpOnly cookie keeps that
// PayPal account (payer id and email) for a month, so they see their orders from any browser. Paid here:
// a second signed cookie lists the orders this browser paid for. Either one makes someone the buyer of
// an order (they may ask for a refund on it); a link alone only shows it. Neither opens the owner area.
import 'server-only';
import { cookies } from 'next/headers';
import type { PayPalIdentity } from '@/core/paypal/identity.ts';
import { paidByPayer, type CartStore, type PayerRef } from '@/core/stores.ts';
import { ready } from './context.ts';

const BUYER_COOKIE = 'sayso_buyer';
const FOR_BUYER_COOKIE = 'sayso_paypal_for';
const PAID_HERE_COOKIE = 'sayso_paid_here';
const PAID_HERE_MAX = 20;
const QUARTER = 90 * 86_400_000;
const MONTH = 30 * 86_400_000;
const TEN_MINUTES = 10 * 60_000;

export interface BuyerSession extends PayerRef {
  name?: string;
}

async function setCookie(name: string, value: string, ttlMs: number): Promise<void> {
  (await cookies()).set(name, value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.floor(ttlMs / 1000) });
}

/** This browser is going to PayPal to see its orders (not to open a shop): the callback reads it once. */
export async function markBuyerSignIn(): Promise<void> {
  await setCookie(FOR_BUYER_COOKIE, (await ready()).access.signValue('paypal-for', 'buyer', TEN_MINUTES), TEN_MINUTES);
}

/** Whether the sign-in coming back is a buyer's, consumed by reading it. */
export async function takeBuyerSignIn(): Promise<boolean> {
  const jar = await cookies();
  const value = (await ready()).access.verifyValue('paypal-for', jar.get(FOR_BUYER_COOKIE)?.value);
  jar.delete(FOR_BUYER_COOKIE);
  return value === 'buyer';
}

/** Forget a buyer sign-in this browser started and didn't finish. */
export async function forgetBuyerSignIn(): Promise<void> {
  (await cookies()).delete(FOR_BUYER_COOKIE);
}

export async function startBuyerSession(who: PayPalIdentity): Promise<void> {
  if (!who.payerId && !who.email) throw new Error('PayPal did not say which account signed in');
  const session: BuyerSession = { ...(who.payerId ? { payerId: who.payerId } : {}), ...(who.email ? { email: who.email.toLowerCase() } : {}), ...(who.name ? { name: who.name } : {}) };
  // Encoded: signed values can't hold dots, and emails have them.
  await setCookie(BUYER_COOKIE, (await ready()).access.signValue('buyer', Buffer.from(JSON.stringify(session)).toString('base64url'), MONTH), MONTH);
}

/** The buyer signed in with PayPal in this browser, if any. */
export async function buyerSession(): Promise<BuyerSession | undefined> {
  const value = (await ready()).access.verifyValue('buyer', (await cookies()).get(BUYER_COOKIE)?.value);
  if (!value) return undefined;
  try {
    const session = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as BuyerSession;
    return session.payerId || session.email ? session : undefined;
  } catch {
    return undefined;
  }
}

export async function endBuyerSession(): Promise<void> {
  (await cookies()).delete(BUYER_COOKIE);
}

/** This browser just paid for `cartId` (only call it once the payment went through). */
export async function rememberPaidHere(cartId: string): Promise<void> {
  const ids = [cartId, ...(await paidHere()).filter((id) => id !== cartId)].slice(0, PAID_HERE_MAX);
  await setCookie(PAID_HERE_COOKIE, (await ready()).access.signValue('paid-here', ids.join('~'), QUARTER), QUARTER);
}

/** This browser forgets which orders it paid for (they stay the buyer's through their PayPal sign-in). */
export async function forgetPaidHere(): Promise<void> {
  (await cookies()).delete(PAID_HERE_COOKIE);
}

/** Orders this browser paid for, newest first. */
export async function paidHere(): Promise<string[]> {
  const value = (await ready()).access.verifyValue('paid-here', (await cookies()).get(PAID_HERE_COOKIE)?.value);
  return value ? value.split('~').filter(Boolean) : [];
}

/** Whether the person here is the order's buyer: paid in this browser, or signed in with the PayPal that paid. */
export async function ownsOrder(carts: CartStore, cartId: string): Promise<boolean> {
  if ((await paidHere()).includes(cartId)) return true;
  const who = await buyerSession();
  if (!who) return false;
  const cart = await carts.get(cartId);
  return Boolean(cart && paidByPayer(cart, who));
}
