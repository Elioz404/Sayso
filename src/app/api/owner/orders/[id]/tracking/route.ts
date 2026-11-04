// Add tracking to a paid order: POST { carrier, tracking_number }. PayPal shows it to the buyer.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { carrier, tracking_number } = await readJson<{ carrier?: string; tracking_number?: string }>(request);
    const number = String(tracking_number ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{4,64}$/.test(number)) throw new HttpError(400, 'Enter the tracking number as printed on the label');
    if (!carrier?.trim()) throw new HttpError(400, 'Pick the carrier');
    return Response.json(await (await ready()).orders.addTracking(shopId, (await params).id, carrier.slice(0, 40), number));
  });
}
