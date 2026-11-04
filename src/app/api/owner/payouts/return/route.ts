// PayPal sends the owner back here after connecting their account. What PayPal put in the URL is not
// trusted: Sayso asks PayPal which account completed this shop's sign-up and what it allowed.
import { ready } from '@/server/context.ts';
import { ownerSession } from '@/server/http.ts';
import { logError } from '@/server/log.ts';

export async function GET() {
  const { payouts, links } = await ready();
  const session = await ownerSession();
  if (!session || session.kind !== 'owner') return Response.redirect(links.owner.home, 303);
  const outcome = await payouts.finish(session.shopId).catch((err: unknown) => {
    logError('payouts', err);
    return { status: 'failed' as const };
  });
  return Response.redirect(`${links.owner.home}?payouts=${outcome.status}`, 303);
}
