// A seller's uploaded product photo. Ids are random and photos never change, so browsers and the image
// optimizer may keep them for good.
import { ready } from '@/server/context.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = /^med_[0-9a-f]{18}$/.test(id) ? await (await ready()).media.get(id) : undefined;
  if (!photo) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(photo.data, 'base64'), {
    headers: { 'Content-Type': photo.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
