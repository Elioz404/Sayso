// PayPal sends the owner back here after connecting their account. What PayPal put in the URL is not
// trusted: Sayso asks PayPal which account completed this shop's sign-up and what it allowed.
import { ready } from '@/server/context.ts';
import { ownerSession } from '@/server/http.ts';

export async function GET() {
  const { payouts, links } = await ready();
  const session = await ownerSession();
  if (!session || session.kind !== 'owner') return Response.redirect(`${links.base}/owner`, 303);
  const outcome = await payouts.finish(session.shopId).catch((err: unknown) => {
    console.error('[payouts]', err);
    return { status: 'failed' as const };
  });
  return Response.redirect(`${links.base}/owner?payouts=${outcome.status}`, 303);
}
