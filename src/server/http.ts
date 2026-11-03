import 'server-only';
import { cookies } from 'next/headers';
import { HttpError, notFound } from '@/core/errors.ts';
import { PayPalError } from '@/core/paypal/client.ts';
import { ready, siteLinks } from './context.ts';

export const OWNER_COOKIE = 'sayso_owner';

/** Shop id of the signed-in owner, if any. Agent keys never produce an owner session. */
export async function ownerShopId(): Promise<string | undefined> {
  const { access } = await ready();
  return access.verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
}

export async function requireOwner(request: Request): Promise<string> {
  assertSameOrigin(request);
  const shopId = await ownerShopId();
  if (!shopId) throw new HttpError(401, 'Sign in as the shop owner first');
  return shopId;
}

/** Owner actions are cookie-authenticated, so refuse cross-site requests outright. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== siteLinks().base) {
    throw new HttpError(403, 'Cross-site request refused');
  }
}

/** The id of the live shop at `slug`, for routes scoped to one shop. */
export async function liveShopId(slug: string): Promise<string> {
  const catalog = await (await ready()).catalogs.bySlug(slug);
  if (!catalog || (catalog.shop.status ?? 'live') !== 'live') throw notFound(`Shop ${slug}`);
  return catalog.shop.id;
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
