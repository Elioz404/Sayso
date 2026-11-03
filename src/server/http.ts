import 'server-only';
import { HttpError } from '@/core/commerce.ts';
import { PayPalError } from '@/core/paypal/client.ts';

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
    return Response.json({ name: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' }, { status: 500 });
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
