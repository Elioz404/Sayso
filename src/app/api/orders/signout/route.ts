// Forget the buyer's PayPal sign-in in this browser (a plain form post, so it works without scripts).
import { endBuyerSession } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await endBuyerSession();
    return Response.redirect(`${(await ready()).links.base}/orders?signin=out`, 303);
  });
}
