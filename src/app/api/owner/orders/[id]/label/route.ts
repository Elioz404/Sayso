// Read a shipping label photo: POST { image: data URL } -> { carrier, tracking_number, note }. Nothing
// is sent to PayPal here; the owner checks the reading and adds it with /tracking.
import { readShippingLabel } from '@/core/ai/label.ts';
import { fromLlmError, HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';
import { checkPhotos } from '@/server/photos.ts';
import { photoReads } from '@/server/rate-limit.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { image } = await readJson<{ image?: unknown }>(request);
    const [photo] = checkPhotos([image], 1);
    const { model, orders } = await ready();
    if (!model) throw new HttpError(503, 'Reading labels needs an AI key on the server; type the number instead');
    await orders.get(shopId, (await params).id); // only this shop's orders
    if (!photoReads.allow(shopId)) throw new HttpError(429, 'That is a lot of photos for one hour; type the number instead');
    const reading = await readShippingLabel(model, photo).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read that label');
    });
    return Response.json({ carrier: reading.carrier ?? null, tracking_number: reading.trackingNumber ?? null, note: reading.note ?? null });
  });
}
