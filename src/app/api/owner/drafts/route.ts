// New products from the owner's photos: POST { images: data URLs, note? } -> drafts that wait for the
// owner's price before buyers see them.
import { HttpError } from '@/core/errors.ts';
import { MAX_DRAFT_PHOTOS } from '@/core/limits.ts';
import { ready } from '@/server/context.ts';
import { handle, PHOTO_BODY_LIMIT, readBody, requireOwnShop } from '@/server/http.ts';
import { limitAi, photoReads } from '@/server/rate-limit.ts';

const PHOTOS = {
  type: 'object',
  properties: { images: { type: 'array', minItems: 1, maxItems: MAX_DRAFT_PHOTOS, items: { type: 'string' } }, note: { type: 'string', maxLength: 1_000 } },
  required: ['images'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { images, note } = await readBody(request, PHOTOS, PHOTO_BODY_LIMIT);
    limitAi(request);
    if (!photoReads.allow(shopId)) throw new HttpError(429, 'That is a lot of photos for one hour; try again later');
    const drafts = await (await ready()).shops.draftFromPhotos(shopId, images, note);
    return Response.json({ drafts: drafts.map((d) => ({ id: d.id, name: d.name })) });
  });
}
