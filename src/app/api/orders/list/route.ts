// POST /api/orders/list { here }: one list of the buyer's orders, newest first, for My orders and the
// panel's Orders tab. From their PayPal sign-in, the orders this browser paid for (its signed cookie),
// and the links this browser kept (`here`, from before that cookie existed); each shown only as a buyer
// may see it.
import { buyerOrder, buyerOrders, type BuyerOrder } from '@/core/buyer-orders.ts';
import { buyerSession, paidHere } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';

const LIST = { type: 'object', properties: { here: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } } } } as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { here } = await readBody(request, LIST);
    const { carts, catalogs, orders, links, paypalLogin } = await ready();
    const deps = { carts, catalogs, orders, links };
    const who = await buyerSession();
    const mine = who ? await buyerOrders(deps, who) : [];
    const ids = [...new Set([...(await paidHere()), ...(here ?? [])])].filter((id) => !mine.some((o) => o.id === id));
    const more = (await Promise.all(ids.map((id) => buyerOrder(deps, id)))).filter((o): o is BuyerOrder => Boolean(o));
    const all = [...mine, ...more].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    return Response.json({ signedIn: Boolean(who), who: who?.email ?? who?.name, canSignIn: paypalLogin, orders: all }, { headers: { 'Cache-Control': 'no-store' } });
  });
}
