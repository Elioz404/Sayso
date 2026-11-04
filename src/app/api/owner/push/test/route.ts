// Sends a test notification to every device of the signed-in owner.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, requireOwnShop } from '@/server/http.ts';
import { testPushes } from '@/server/rate-limit.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    if (!testPushes.allow(shopId)) throw new HttpError(429, 'One test a minute; the last one is on its way.');
    const { push, links } = await ready();
    const sent = await push.notify(shopId, {
      title: 'Sayso is on your phone',
      body: 'This is where your agents will ask for your say-so.',
      url: links.owner.phone,
      tag: 'sayso-test',
    });
    if (!sent) throw new HttpError(409, 'No device got it. Turn notifications on first.');
    return Response.json({ sent });
  });
}
