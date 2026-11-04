// A buyer signed in with PayPal, so they can see their orders from any browser without a Sayso account.
// PayPal says who they are; the signed, httpOnly cookie only keeps that PayPal account (payer id and
// email) for a month. It opens nothing but the buyer's own orders, and never the owner area.
import 'server-only';
import { cookies } from 'next/headers';
import type { PayPalIdentity } from '@/core/paypal/identity.ts';
import type { PayerRef } from '@/core/stores.ts';
import { ready } from './context.ts';

const BUYER_COOKIE = 'sayso_buyer';
const FOR_BUYER_COOKIE = 'sayso_paypal_for';
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
