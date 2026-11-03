// A tiny in-memory stand-in for the PayPal sandbox REST API, enough to run the merchant-cart flow
// offline: OAuth, Orders v2 (create / get / authorize / track), Payments v2 (authorizations, captures,
// refunds), Vault, Invoicing and Catalog Products. Like PayPal, it refuses impossible calls (capturing a
// voided hold, refunding more than was captured), and it records every PayPal-Request-Id to prove
// idempotency. `failReads` makes GETs under a path fail, to test what happens when a read-back breaks.

type Json = Record<string, any>;

export interface FakePayPal {
  fetch: typeof fetch;
  orders: Map<string, Json>;
  requestIds: string[];
  catalogProducts: Json[];
  tracking: Json[];
  /** Simulate the buyer approving a vault setup token in PayPal. */
  approveSetup(setupTokenId: string): void;
  paymentTokens: Map<string, Json>;
  invoices: Map<string, Json>;
  /** Simulate the buyer paying an invoice, in full or only its deposit. */
  payInvoice(invoiceId: string, part?: 'deposit'): void;
  /** Simulate the buyer clicking "Pay" on the PayPal approval page. */
  approve(orderId: string): void;
  /** Make every GET whose path starts with `prefix` fail (undefined: stop failing). */
  failReads(prefix: string | undefined): void;
  authorizations: Map<string, Json>;
  /** Log in with PayPal: a one-time code for this person, as PayPal's sign-in page would send back. */
  signInCode(person: { user_id: string; payer_id?: string; email?: string; name?: string; verified?: boolean }): string;
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
  const setupTokens = new Map<string, Json>();
  const paymentTokens = new Map<string, Json>();
  const invoices = new Map<string, Json>();
  let invoiceNumber = 0;
  const replays = new Map<string, Json>();
  const requestIds: string[] = [];
  let failingReads: string | undefined;
  const signInCodes = new Map<string, Json>(); // code -> person; each code works once
  const userTokens = new Map<string, Json>(); // user access token -> person
  let seq = 0;
  const id = (prefix: string) => `${prefix}${(++seq).toString().padStart(6, '0')}`;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = () => json({ name: 'RESOURCE_NOT_FOUND' }, 404);
  const refuse = (issue: string) => json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue }] }, 422);
  const minor = (m: Json) => Math.round(Number(m.value) * 100);

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    if (path === '/v1/oauth2/token') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      if (form.get('grant_type') !== 'authorization_code') return json({ access_token: 'fake-token', expires_in: 32_400 });
      const person = signInCodes.get(form.get('code') ?? '');
      if (!person) return json({ error: 'invalid_grant' }, 400);
      signInCodes.delete(form.get('code')!);
      const token = id('user-token-');
      userTokens.set(token, person);
      return json({ access_token: token, token_type: 'Bearer', expires_in: 28_800 });
    }
    if (path === '/v1/identity/oauth2/userinfo') {
      const person = userTokens.get(new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '');
      if (!person) return json({ name: 'AUTHENTICATION_FAILURE' }, 401);
      return json({
        user_id: person.user_id,
        payer_id: person.payer_id,
        name: person.name,
        emails: person.email ? [{ value: person.email, primary: true, confirmed: true }] : [],
        verified_account: String(person.verified ?? true),
      });
    }

    // 403 rather than a 5xx so the client does not spend seconds retrying in tests.
    if (method === 'GET' && failingReads && path.startsWith(failingReads)) return json({ name: 'NOT_AUTHORIZED' }, 403);

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
    if (method === 'POST' && path === '/v2/checkout/orders' && body.payment_source?.paypal?.vault_id) {
      // A saved PayPal account: no buyer redirect, PayPal authorizes at once.
      const token = paymentTokens.get(body.payment_source.paypal.vault_id);
      if (!token) return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_VAULT_ID' }] }, 422);
      const orderId = id('ORDER');
      const amount = { currency_code: body.purchase_units[0].amount.currency_code, value: body.purchase_units[0].amount.value };
      const auth = { id: id('AUTH'), status: 'CREATED', amount, expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString() };
      const order = {
        id: orderId,
        intent: body.intent,
        status: 'COMPLETED',
        payer: { payer_id: 'BUYER123', email_address: token.payment_source.paypal.email_address },
        purchase_units: [{ reference_id: body.purchase_units[0].reference_id, amount, payments: { authorizations: [auth] } }],
        links: [],
      };
      orders.set(orderId, order);
      authorizations.set(auth.id, auth);
      authOrder.set(auth.id, order);
      return remember(order);
    }
    if (method === 'POST' && path === '/v2/invoicing/invoices') {
      const invoice = {
        id: id('INV2-'),
        status: 'DRAFT',
        detail: { ...body.detail, invoice_number: String(++invoiceNumber).padStart(4, '0'), metadata: {} },
        primary_recipients: body.primary_recipients,
        items: body.items,
        configuration: body.configuration,
      };
      invoices.set(invoice.id, invoice);
      return remember(invoice);
    }
    if (method === 'POST' && (m = /^\/v2\/invoicing\/invoices\/([^/]+)\/send$/.exec(path))) {
      const invoice = invoices.get(m[1]);
      if (!invoice) return notFound();
      invoice.status = 'SENT';
      invoice.detail.metadata.recipient_view_url = `https://www.sandbox.paypal.com/invoice/p/#${invoice.id}`;
      return remember({ href: invoice.detail.metadata.recipient_view_url }, 200);
    }
    if (method === 'GET' && (m = /^\/v2\/invoicing\/invoices\/([^/]+)$/.exec(path))) return invoices.has(m[1]) ? json(invoices.get(m[1])) : notFound();
    if (method === 'POST' && path === '/v3/vault/setup-tokens') {
      const token = { id: id('SETUP'), status: 'PAYER_ACTION_REQUIRED', customer: { id: 'customer_1' }, links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=x' }] };
      setupTokens.set(token.id, token);
      return remember(token);
    }
    if (method === 'GET' && (m = /^\/v3\/vault\/setup-tokens\/([^/]+)$/.exec(path))) return setupTokens.has(m[1]) ? json(setupTokens.get(m[1])) : notFound();
    if (method === 'POST' && path === '/v3/vault/payment-tokens') {
      const setup = setupTokens.get(body.payment_source.token.id);
      if (setup?.status !== 'APPROVED') return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'SETUP_TOKEN_NOT_APPROVED' }] }, 422);
      const token = { id: id('PTOK'), customer: { id: 'customer_1' }, payment_source: { paypal: { email_address: 'buyer@example.com', payer_id: 'BUYER123' } } };
      paymentTokens.set(token.id, token);
      return remember(token);
    }
    if (method === 'DELETE' && (m = /^\/v3\/vault\/payment-tokens\/([^/]+)$/.exec(path))) {
      paymentTokens.delete(m[1]);
      return new Response(null, { status: 204 });
    }
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
      const order = orders.get(m[1]);
      if (!order) return notFound();
      if (order.status !== 'APPROVED') return refuse('ORDER_NOT_APPROVED');
      const auth = { id: id('AUTH'), status: 'CREATED', amount: order.purchase_units[0].amount, expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString() };
      authorizations.set(auth.id, auth);
      authOrder.set(auth.id, order);
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { authorizations: [auth] };
      return remember(order);
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(path))) return authorizations.has(m[1]) ? json(authorizations.get(m[1])) : notFound();
    if (method === 'POST' && (m = /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/.exec(path))) {
      const auth = authorizations.get(m[1]);
      if (!auth) return notFound();
      if (auth.status !== 'CREATED') return refuse('AUTHORIZATION_ALREADY_CAPTURED');
      const amount = body.amount ?? auth.amount;
      if (minor(amount) > minor(auth.amount)) return refuse('CAPTURE_AMOUNT_EXCEEDS_AUTHORIZED');
      auth.status = 'CAPTURED';
      const capture = { id: id('CAP'), status: 'COMPLETED', amount };
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
      const auth = authorizations.get(m[1]);
      if (!auth) return notFound();
      if (auth.status !== 'CREATED') return refuse('PREVIOUSLY_CAPTURED_OR_VOIDED');
      auth.status = 'VOIDED';
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(path))) return captures.has(m[1]) ? json(captures.get(m[1])) : notFound();
    if (method === 'POST' && (m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path))) {
      const capture = captures.get(m[1]);
      if (!capture) return notFound();
      const payments = captureOrder.get(m[1])?.purchase_units[0].payments;
      const refunded = (payments?.refunds ?? []).reduce((sum: number, r: Json) => sum + minor(r.amount), 0);
      const amount = body.amount ?? capture.amount;
      if (minor(amount) > minor(capture.amount) - refunded) return refuse('REFUND_AMOUNT_EXCEEDED');
      const refund = { id: id('REF'), status: 'COMPLETED', amount };
      refunds.set(refund.id, refund);
      if (payments) payments.refunds = [...(payments.refunds ?? []), refund];
      return remember(refund);
    }
    if (method === 'GET' && (m = /^\/v2\/payments\/refunds\/([^/]+)$/.exec(path))) return refunds.has(m[1]) ? json(refunds.get(m[1])) : notFound();
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
    signInCode(person) {
      const code = id('code-');
      signInCodes.set(code, person);
      return code;
    },
    fetch: handler as typeof fetch,
    orders,
    requestIds,
    catalogProducts,
    tracking,
    paymentTokens,
    invoices,
    authorizations,
    failReads(prefix) {
      failingReads = prefix;
    },
    payInvoice(invoiceId, part) {
      const invoice = invoices.get(invoiceId)!;
      invoice.status = part === 'deposit' ? 'PARTIALLY_PAID' : 'PAID';
      invoice.payments = { transactions: [{ payment_date: new Date().toISOString().slice(0, 10) }] };
    },
    approveSetup(setupTokenId) {
      setupTokens.get(setupTokenId)!.status = 'APPROVED';
    },
    approve(orderId) {
      orders.get(orderId)!.status = 'APPROVED';
      orders.get(orderId)!.payer = { payer_id: 'BUYER123', email_address: 'buyer@example.com' };
    },
  };
}
