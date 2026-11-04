// New products from the owner's photos: POST { images: data URLs, note? } -> drafts that wait for the
// owner's price before buyers see them.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice } from '@/server/http.ts';
import { checkPhotos } from '@/server/photos.ts';
import { photoReads } from '@/server/rate-limit.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const body = await readJson<{ images?: unknown; note?: string }>(request);
    const images = checkPhotos(body.images, 6);
    if (!photoReads.allow(shopId)) throw new HttpError(429, 'That is a lot of photos for one hour; try again later');
    const drafts = await (await ready()).shops.draftFromPhotos(shopId, images, typeof body.note === 'string' ? body.note.slice(0, 1_000) : '');
    return Response.json({ drafts: drafts.map((d) => ({ id: d.id, name: d.name })) });
  });
}
