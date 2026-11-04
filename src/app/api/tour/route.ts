// POST: start the judges' tour. Makes a private copy of the demo shop and signs this browser in as its
// owner until the copy expires, so the judge can give (or refuse) every say-so themselves.
import { HttpError, notFound } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, startOwnerSession } from '@/server/http.ts';
import { clientAddress, tourStarts } from '@/server/rate-limit.ts';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { tours } = await ready();
    if (!tours) throw notFound('Tour');
    if (!tourStarts.allow(clientAddress(request))) throw new HttpError(429, 'A few tours an hour from one place; try again later');
    const tour = await tours.start();
    await startOwnerSession(tour.shopId, { expires: new Date(tour.expiresAt) });
    return Response.json({ ok: true, expires_at: tour.expiresAt }, { status: 201 });
  });
}
