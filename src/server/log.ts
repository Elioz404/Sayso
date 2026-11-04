// Server logs: enough to debug, never more. A PayPal error is logged as its message and debug_id, not
// the response body (which can carry payer details); other errors as their stack.
import 'server-only';
import { PayPalError } from '@/core/paypal/client.ts';

export function logError(scope: string, err: unknown): void {
  if (err instanceof PayPalError) console.error(`[${scope}] ${err.message} debug_id=${err.debugId ?? '-'}`);
  else console.error(`[${scope}]`, err instanceof Error ? (err.stack ?? err.message) : String(err));
}

/**
 * A secret generated on boot, for local development only: printed so the developer can sign in. In
 * production it is never written to the logs; set it in the environment instead.
 */
export function showDevSecret(what: string, secret: string, envName: string): void {
  if (process.env.NODE_ENV === 'production') console.warn(`[sayso] ${what} was generated; set ${envName} to know it`);
  else console.log(`[sayso] ${what}: ${secret}`);
}
