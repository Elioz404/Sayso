// Add tracking to a paid order: POST { carrier, tracking_number }. PayPal shows it to the buyer. The
// rules (known carriers, plausible numbers) live in Orders, shared with the agent's add_tracking tool.
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const TRACKING = {
  type: 'object',
  properties: { carrier: { type: 'string', maxLength: 40 }, tracking_number: { type: 'string', maxLength: 64 } },
  required: ['carrier', 'tracking_number'],
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { carrier, tracking_number } = await readBody(request, TRACKING);
    return Response.json(await (await ready()).orders.addTracking(shopId, (await params).id, carrier, tracking_number));
  });
}
