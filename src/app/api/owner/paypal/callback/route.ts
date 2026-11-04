// Log in with PayPal, step 2: PayPal sends the owner back with a one-time code. Check it came from the
// sign-in this browser started, learn who it is from PayPal, claim the shop this browser just created
// (if any), and open the seller's shop.
import { HttpError } from '@/core/errors.ts';
import { identityFromCode } from '@/core/paypal/identity.ts';
import { ready } from '@/server/context.ts';
import { startBuyerSession, takeBuyerSignIn } from '@/server/buyer-session.ts';
import { startOwnerSession } from '@/server/http.ts';
import { checkSignInState, startSellerSession, takeClaim, takeNext } from '@/server/seller-session.ts';
import { logError } from '@/server/log.ts';

export async function GET(request: Request) {
  const { paypal, sellers, links } = await ready();
  const params = new URL(request.url).searchParams;
  // A buyer signing in to see their orders comes back here too (the one return address PayPal knows).
  const forBuyer = await takeBuyerSignIn();
  const back = (outcome: string) => Response.redirect(forBuyer ? `${links.base}/orders?signin=${outcome}` : `${links.owner.home}?signin=${outcome}`, 303);

  if (!(await checkSignInState(params.get('state')))) return back('expired');
  const code = params.get('code');
  if (!code) return back('cancelled'); // they closed PayPal or said no

  if (forBuyer) {
    try {
      // Only who they are: no seller record, no shop, no owner session.
      await startBuyerSession(await identityFromCode(paypal, code, links.paypalSignInReturn));
      await takeNext();
      return Response.redirect(`${links.base}/orders`, 303);
    } catch (err) {
      logError('paypal buyer sign-in', err);
      return back('failed');
    }
  }

  try {
    const seller = await sellers.signIn(await identityFromCode(paypal, code, links.paypalSignInReturn));
    await startSellerSession(seller.id);
    const claim = await takeClaim();
    if (claim) await sellers.claim(claim, seller.id);
    const shopId = claim ?? (await sellers.shops(seller.id))[0]?.shop.id;
    if (!shopId) return back('no-shop');
    await startOwnerSession(shopId);
    return Response.redirect(`${links.base}${await takeNext()}`, 303);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return back('taken');
    logError('paypal sign-in', err);
    return back('failed');
  }
}
