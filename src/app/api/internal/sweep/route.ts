// POST: the hourly cleanup. Expired tour copies (and everything they made), carts abandoned before they
// were paid, spent one-time codes. Meant for a scheduled job (Render Cron), authenticated with
// `Authorization: Bearer $SAYSO_CRON_SECRET`; without that secret configured the route doesn't exist.
import { timingSafeEqual } from 'node:crypto';
import { HttpError, notFound } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const secret = process.env.SAYSO_CRON_SECRET;
    if (!secret) throw notFound('Route');
    const given = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Wrong or missing cron secret');
    const { tours, housekeeping } = await ready();
    const toursRemoved = tours ? await tours.sweep() : 0;
    const swept = housekeeping ? await housekeeping.sweep() : { carts: 0, codes: 0 };
    return Response.json({ tours_removed: toursRemoved, abandoned_carts_removed: swept.carts, expired_codes_removed: swept.codes });
  });
}
