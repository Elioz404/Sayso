// GET /api/orders/mine: the orders of the buyer signed in with PayPal in this browser (none if not), and
// whether they can sign in here, for the Orders tab of the shopping panel.
import { buyerOrders, type BuyerOrder } from '@/core/buyer-orders.ts';
import { buyerSession } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { handle } from '@/server/http.ts';

export async function GET() {
  return handle(async () => {
    const { carts, catalogs, orders, links, paypalLogin } = await ready();
    const who = await buyerSession();
    const mine: BuyerOrder[] = who ? await buyerOrders({ carts, catalogs, orders, links }, who) : [];
    return Response.json(
      { signedIn: Boolean(who), who: who?.email ?? who?.name, canSignIn: paypalLogin, orders: mine },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
