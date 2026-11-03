import 'server-only';
import { cookies } from 'next/headers';
import type { AgentKey } from '@/core/access.ts';
import { HttpError } from '@/core/commerce.ts';
import { PayPalError } from '@/core/paypal/client.ts';
import { ready } from './context.ts';

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

export async function agentFrom(request: Request): Promise<AgentKey | undefined> {
  const { access } = await ready();
  return access.agentFromHeader(request.headers.get('authorization'));
}

/** Owner actions are cookie-authenticated, so refuse cross-site requests outright. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')) {
    throw new HttpError(403, 'Cross-site request refused');
  }
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

/**
 * PayPal's Commerce Platform calls the merchant-cart API with a PayPal-issued JWT. In the sandbox
 * demo our own agents call it, so verification is opt-in until the platform is onboarded.
 * TODO: verify the JWT signature against PayPal's public keys when SAYSO_REQUIRE_PAYPAL_JWT=true.
 */
export function assertCallerAllowed(request: Request): void {
  if (process.env.SAYSO_REQUIRE_PAYPAL_JWT !== 'true') return;
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) throw new HttpError(401, 'Missing PayPal JWT');
}
