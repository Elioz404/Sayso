// Read a shipping label photo: POST { image: data URL } -> { carrier, tracking_number, note }. Nothing
// is sent to PayPal here; the owner checks the reading and adds it with /tracking.
import { readShippingLabel } from '@/core/ai/label.ts';
import { fromLlmError, HttpError } from '@/core/errors.ts';
import { checkPhotos } from '@/core/media.ts';
import { ready } from '@/server/context.ts';
import { handle, PHOTO_BODY_LIMIT, readBody, requireOwnShop } from '@/server/http.ts';
import { limitAi, photoReads } from '@/server/rate-limit.ts';

const LABEL = { type: 'object', properties: { image: { type: 'string' } }, required: ['image'] } as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { image } = await readBody(request, LABEL, PHOTO_BODY_LIMIT);
    const [photo] = checkPhotos([image], 1);
    const { model, orders } = await ready();
    if (!model) throw new HttpError(503, 'Reading labels needs an AI key on the server; type the number instead');
    await orders.get(shopId, (await params).id); // only this shop's orders
    limitAi(request);
    if (!photoReads.allow(shopId)) throw new HttpError(429, 'That is a lot of photos for one hour; type the number instead');
    const reading = await readShippingLabel(model, photo).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read that label');
    });
    return Response.json({ carrier: reading.carrier ?? null, tracking_number: reading.trackingNumber ?? null, note: reading.note ?? null });
  });
}
