// PayPal's webhooks: POST, signed by PayPal. The signature is checked against the raw body before
// anything is read; then the event goes to PayPalEvents, which reads what it names back from PayPal and
// keeps Sayso in step. 2xx tells PayPal it arrived (an event about something that isn't Sayso's
// included); a 5xx makes PayPal send it again later, which is safe: every handler can run twice.
import { HttpError } from '@/core/errors.ts';
import { transmissionOf } from '@/core/paypal/webhooks.ts';
import { ready } from '@/server/context.ts';
import { handle, readText } from '@/server/http.ts';
import { logInfo } from '@/server/log.ts';

/** PayPal's events are a few KB; nothing legitimate comes near this. */
const EVENT_LIMIT = 64 * 1024;

export async function POST(request: Request) {
  return handle(async () => {
    const { webhooks, paypalEvents } = await ready();
    if (!webhooks) throw new HttpError(503, 'PayPal webhooks are not set up on this server (PAYPAL_WEBHOOK_ID)');
    const raw = await readText(request, EVENT_LIMIT);
    const verified = await webhooks.verify(raw, transmissionOf((name) => request.headers.get(name)));
    if (!verified) throw new HttpError(401, 'Not a PayPal webhook delivery this server can verify');
    const { event, from } = verified;
    const outcome = await paypalEvents.handle(event);
    logInfo('paypal-webhook', `${event.event_type} ${event.id}${from === 'simulator' ? ' (simulator)' : ''}: ${outcome.result}${outcome.shopId ? ` shop=${outcome.shopId}` : ''}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    return Response.json({ received: event.id, result: outcome.result });
  });
}
