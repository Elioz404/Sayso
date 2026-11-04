import 'server-only';
import { cookies } from 'next/headers';
import type { OwnerSession } from '@/core/access.ts';
import { isLive, type Catalog } from '@/core/catalog.ts';
import { HttpError, notFound } from '@/core/errors.ts';
import { PayPalError } from '@/core/paypal/client.ts';
import { ready, siteLinks } from './context.ts';

export const OWNER_COOKIE = 'sayso_owner';

/** The signed-in owner's session, if any. Agent keys never produce one. */
export async function ownerSession(): Promise<OwnerSession | undefined> {
  const { access } = await ready();
  return access.verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
}

/** Sign this browser in as `shopId`'s owner until `expires`. */
export async function startOwnerSession(shopId: string, kind: OwnerSession['kind'], expires: Date): Promise<void> {
  const { access } = await ready();
  const ttlMs = expires.getTime() - Date.now();
  (await cookies()).set(OWNER_COOKIE, access.signOwnerSession(shopId, ttlMs, Date.now(), kind), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });
}

/** Shop id of the signed-in owner, if any. */
export async function ownerShopId(): Promise<string | undefined> {
  return (await ownerSession())?.shopId;
}

export async function requireOwner(request: Request): Promise<string> {
  assertSameOrigin(request);
  const shopId = await ownerShopId();
  if (!shopId) throw new HttpError(401, 'Sign in as the shop owner first');
  return shopId;
}

/**
 * Like requireOwner, but not in the shared public demo session: things tied to one person's device
 * (passkeys, notifications, signing in on a phone) would otherwise be shared by every visitor.
 */
export async function requireOwnDevice(request: Request): Promise<{ shopId: string; kind: OwnerSession['kind'] }> {
  assertSameOrigin(request);
  const session = await ownerSession();
  if (!session) throw new HttpError(401, 'Sign in as the shop owner first');
  if (session.kind === 'demo') throw new HttpError(403, "The shared demo shop can't be tied to your phone. Start the judges' tour for a shop of your own.");
  return session;
}

/** Owner actions are cookie-authenticated, so refuse cross-site requests outright. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== siteLinks().base) {
    throw new HttpError(403, 'Cross-site request refused');
  }
}

/** The live shop at `slug`, for routes scoped to one shop. */
export async function liveCatalog(slug: string): Promise<Catalog> {
  const catalog = await (await ready()).catalogs.bySlug(slug);
  if (!catalog || !isLive(catalog)) throw notFound(`Shop ${slug}`);
  return catalog;
}

/** A yes/no query parameter: "true" or "1" mean yes. */
export function flag(search: URLSearchParams, name: string): boolean {
  return ['true', '1'].includes(search.get(name)?.toLowerCase() ?? '');
}

/** Who is shopping, as the client says (for the owner's dashboard only; never trusted for access). */
export function channelOf(request: Request, fallback: string): string {
  return request.headers.get('x-sayso-channel')?.trim().slice(0, 40) || fallback;
}

/** Run a route body and map known errors to the JSON shapes the merchant-cart spec expects. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return Response.json(err.body, { status: err.status });
    if (err instanceof PayPalError) {
      console.error(`[paypal] ${err.message} debug_id=${err.debugId ?? '-'}`);
      return Response.json({ name: 'PAYPAL_ERROR', message: err.message, debug_id: err.debugId }, { status: 502 });
    }
    console.error(err);
    const message = err instanceof Error && /PAYPAL_CLIENT_ID/.test(err.message) ? 'PayPal sandbox keys are not configured on this server' : 'Unexpected error';
    return Response.json({ name: 'INTERNAL_SERVER_ERROR', message }, { status: 500 });
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

/** What signs the ten-minute "continue on your phone" link. */
export const HANDOFF_PURPOSE = 'owner-handoff';
