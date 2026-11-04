// The cookies around Log in with PayPal: the OAuth state that ties PayPal's answer to this browser, the
// claim on a shop this browser just created, and who signed in with PayPal (so they can switch between
// their shops). All signed and httpOnly; none of them alone opens a shop, the owner session does that.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { ready } from './context.ts';

const STATE_COOKIE = 'sayso_paypal_state';
const NEXT_COOKIE = 'sayso_paypal_next';
const CLAIM_COOKIE = 'sayso_claim';
const PUBLISH_COOKIE = 'sayso_publish';
const SELLER_COOKIE = 'sayso_seller';
const TEN_MINUTES = 10 * 60_000;
const HOUR = 60 * 60_000;
const WEEK = 7 * 86_400_000;

async function setCookie(name: string, value: string, ttlMs: number): Promise<void> {
  (await cookies()).set(name, value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.floor(ttlMs / 1000) });
}

/**
 * A fresh `state` for the PayPal sign-in link, remembered in this browser for ten minutes, with the page
 * to land on afterwards (a path on this site only, never another site).
 */
export async function newSignInState(next?: string | null): Promise<string> {
  const state = randomBytes(18).toString('base64url');
  await setCookie(STATE_COOKIE, (await ready()).access.signValue('paypal-state', state, TEN_MINUTES), TEN_MINUTES);
  if (next && /^\/[a-z0-9/_-]*$/i.test(next)) await setCookie(NEXT_COOKIE, next, TEN_MINUTES);
  else (await cookies()).delete(NEXT_COOKIE);
  return state;
}

/** Where the owner was headed when they went to sign in, consumed by reading it. */
export async function takeNext(): Promise<string> {
  const jar = await cookies();
  const next = jar.get(NEXT_COOKIE)?.value;
  jar.delete(NEXT_COOKIE);
  return next && /^\/[a-z0-9/_-]*$/i.test(next) ? next : '/owner';
}

/** Whether PayPal's `state` is the one this browser started with. Usable once. */
export async function checkSignInState(state: string | null): Promise<boolean> {
  const jar = await cookies();
  const expected = (await ready()).access.verifyValue('paypal-state', jar.get(STATE_COOKIE)?.value);
  jar.delete(STATE_COOKIE);
  return Boolean(state && expected && state === expected);
}

/** This browser just created `shopId` and may claim it with PayPal within the hour. */
export async function rememberClaim(shopId: string): Promise<void> {
  await setCookie(CLAIM_COOKIE, (await ready()).access.signValue('claim', shopId, HOUR), HOUR);
}

/** The draft this browser created and may still edit and claim (within the hour); not consumed. */
export async function claimedShop(): Promise<string | undefined> {
  return (await ready()).access.verifyValue('claim', (await cookies()).get(CLAIM_COOKIE)?.value);
}

/** The owner pressed Publish: publish `shopId` as soon as PayPal signs them in (within the hour). */
export async function rememberPublish(shopId: string): Promise<void> {
  await setCookie(PUBLISH_COOKIE, (await ready()).access.signValue('publish', shopId, HOUR), HOUR);
}

/** The shop to publish on this sign-in, consumed by reading it. */
export async function takePublish(): Promise<string | undefined> {
  const jar = await cookies();
  const shopId = (await ready()).access.verifyValue('publish', jar.get(PUBLISH_COOKIE)?.value);
  jar.delete(PUBLISH_COOKIE);
  return shopId;
}

/** The shop this browser may claim, consumed by reading it. */
export async function takeClaim(): Promise<string | undefined> {
  const jar = await cookies();
  const shopId = (await ready()).access.verifyValue('claim', jar.get(CLAIM_COOKIE)?.value);
  jar.delete(CLAIM_COOKIE);
  return shopId;
}

export async function startSellerSession(sellerId: string): Promise<void> {
  await setCookie(SELLER_COOKIE, (await ready()).access.signValue('seller', sellerId, WEEK), WEEK);
}

/** The seller signed in with PayPal in this browser, if any. */
export async function sellerId(): Promise<string | undefined> {
  return (await ready()).access.verifyValue('seller', (await cookies()).get(SELLER_COOKIE)?.value);
}

export async function endSellerSession(): Promise<void> {
  (await cookies()).delete(SELLER_COOKIE);
}
