// "My orders", step 1: send the buyer to Log in with PayPal. They come back through the same PayPal
// return address the owners use; a signed cookie says this sign-in is a buyer's, so it never opens a shop.
import { signInUrl } from '@/core/paypal/identity.ts';
import { markBuyerSignIn } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { newSignInState } from '@/server/seller-session.ts';

export async function GET(request: Request) {
  const { paypal, paypalLogin, links } = await ready();
  if (!paypalLogin) return Response.redirect(`${links.base}/orders?signin=off`, 303);
  // ?next=/order/<id> comes back to that order; anything else to My orders.
  const next = new URL(request.url).searchParams.get('next');
  await markBuyerSignIn();
  return Response.redirect(signInUrl(paypal, links.paypalSignInReturn, await newSignInState(next?.startsWith('/order/') ? next : '/orders')), 303);
}
