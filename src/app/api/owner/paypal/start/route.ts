// Log in with PayPal, step 1: send the owner to PayPal. ?next=/approve/... comes back to that page.
// ?link=1 from a signed-in owner links their PayPal to the shop they are in (one opened with an owner
// secret, before PayPal sign-in).
import { signInUrl } from '@/core/paypal/identity.ts';
import { ready } from '@/server/context.ts';
import { ownerSession } from '@/server/http.ts';
import { newSignInState, rememberClaim } from '@/server/seller-session.ts';

export async function GET(request: Request) {
  const { paypal, paypalLogin, links } = await ready();
  if (!paypalLogin) return Response.redirect(links.owner.home, 303);
  const params = new URL(request.url).searchParams;
  if (params.get('link') === '1') {
    const session = await ownerSession();
    if (session?.kind === 'owner') await rememberClaim(session.shopId);
  }
  return Response.redirect(signInUrl(paypal, links.paypalSignInReturn, await newSignInState(params.get('next'))), 303);
}
