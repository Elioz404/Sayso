// A tiny in-memory stand-in for the PayPal sandbox REST API, enough to run the merchant-cart flow
// offline: OAuth, Orders v2 (create / get / authorize / track), Payments v2 (authorizations, captures,
// refunds) and Catalog Products. It also records every PayPal-Request-Id to prove idempotency.

type Json = Record<string, any>;

export interface FakePayPal {
  fetch: typeof fetch;
  orders: Map<string, Json>;
  requestIds: string[];
  catalogProducts: Json[];
  tracking: Json[];
  /** Simulate the buyer clicking "Pay" on the PayPal approval page. */
  approve(orderId: string): void;
}

export function fakePayPal(): FakePayPal {
  const orders = new Map<string, Json>();
  const authorizations = new Map<string, Json>();
  const captures = new Map<string, Json>();
  const refunds = new Map<string, Json>();
  const captureOrder = new Map<string, Json>();
  const authOrder = new Map<string, Json>();
  const catalogProducts: Json[] = [];
  const tracking: Json[] = [];
  const replays = new Map<string, Json>();
  const requestIds: string[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}${(++seq).toString().padStart(6, '0')}`;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    if (path === '/v1/oauth2/token') return json({ access_token: 'fake-token', expires_in: 32_400 });

    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    const requestId = headers.get('PayPal-Request-Id');

    if (requestId) {
      requestIds.push(requestId);
      const replay = replays.get(`${path}:${requestId}`);
      if (replay) return json(replay, 200);
    }
    const remember = (res: Json, status = 201) => {
      if (requestId) replays.set(`${path}:${requestId}`, res);
      return json(res, status);
    };

    let m: RegExpExecArray | null;
    if (method === 'POST' && path === '/v2/checkout/orders') {
      const orderId = id('ORDER');
      const order = {
        id: orderId,
        intent: body.intent,
        status: 'PAYER_ACTION_REQUIRED',
        purchase_units: body.purchase_units.map((u: Json) => ({ reference_id: u.reference_id, amount: { currency_code: u.amount.currency_code, value: u.amount.value } })),
        links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }],
      };
      orders.set(orderId, order);
      return remember(order);
    }
    if (method === 'GET' && (m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path))) {
      const order = orders.get(m[1]);
      return order ? json(order) : json({ name: 'RESOURCE_NOT_FOUND' }, 404);
    }
    if (method === 'POST' && (m = /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/.exec(path))) {
      const order = orders.get(m[1])!;
      if (order.status !== 'APPROVED') return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] }, 422);
      const auth = { id: id('AUTH'), status: 'CREATED', amount: order.purchase_units[0].amount, expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString() };
      authorizations.set(auth.id, auth);
      authOrder.set(auth.id, order);
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { authorizations: [auth] };
      return remember(order);
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(path))) return json(authorizations.get(m[1]));
    if (method === 'POST' && (m = /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/.exec(path))) {
      const auth = authorizations.get(m[1])!;
      auth.status = 'CAPTURED';
      const capture = { id: id('CAP'), status: 'COMPLETED', amount: body.amount };
      captures.set(capture.id, capture);
      const order = authOrder.get(auth.id);
      if (order) {
        captureOrder.set(capture.id, order);
        const payments = order.purchase_units[0].payments;
        payments.captures = [...(payments.captures ?? []), capture];
      }
      return remember(capture);
    }
    if (method === 'POST' && (m = /^\/v2\/payments\/authorizations\/([^/]+)\/void$/.exec(path))) {
      authorizations.get(m[1])!.status = 'VOIDED';
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(path))) return json(captures.get(m[1]));
    if (method === 'POST' && (m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path))) {
      const refund = { id: id('REF'), status: 'COMPLETED', amount: body.amount };
      refunds.set(refund.id, refund);
      const payments = captureOrder.get(m[1])?.purchase_units[0].payments;
      if (payments) payments.refunds = [...(payments.refunds ?? []), refund];
      return remember(refund);
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/refunds\/([^/]+)$/.exec(path))) return json(refunds.get(m[1]));
    if (method === 'POST' && (m = /^\/v2\/checkout\/orders\/([^/]+)\/track$/.exec(path))) {
      tracking.push({ orderId: m[1], ...body });
      return remember(orders.get(m[1]) ?? {});
    }
    if (method === 'POST' && path === '/v1/catalogs/products') {
      const product = { id: id('PROD-'), ...body };
      catalogProducts.push(product);
      return remember(product);
    }

    return json({ name: 'NOT_IMPLEMENTED_IN_FAKE', message: `${method} ${path}` }, 501);
  };

  return {
    fetch: handler as typeof fetch,
    orders,
    requestIds,
    catalogProducts,
    tracking,
    approve(orderId) {
      orders.get(orderId)!.status = 'APPROVED';
      orders.get(orderId)!.payer = { payer_id: 'BUYER123', email_address: 'buyer@example.com' };
    },
  };
}
