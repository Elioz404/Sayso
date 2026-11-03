// Day-1 smoke test against a running `npm run dev`: acts like an AI agent creating a cart.
//   node scripts/try-cart.ts [baseUrl]
// Prints the PayPal approval URL; open it, log in with a sandbox *personal* account, approve, and
// PayPal redirects to /pay/return which completes the checkout. Then refresh / to see the Guard log.

export {}; // makes this file a module so top-level await type-checks

const base = process.argv[2] ?? 'http://localhost:3000';
const shop = 'maya-ceramics';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/shops/${shop}/merchant-cart${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-sayso-channel': 'smoke-test' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  console.log(`${method} ${path || '/'} -> ${res.status} ${json.status ?? json.name ?? ''}`);
  if (res.status >= 500) {
    console.error('Server error: check the `npm run dev` logs (missing PAYPAL_* keys in .env.local?)');
    process.exit(1);
  }
  return json;
}

const address = { country_code: 'US', admin_area_1: 'TX', admin_area_2: 'Austin', postal_code: '78701', address_line_1: '100 Congress Ave' };

// 1. Ask for 2 speckled mugs (only 1 in stock) -> INCOMPLETE with resolution options.
let cart = await call('POST', '', { items: [{ variant_id: 'var_mug_speckled', quantity: 2 }], shipping_address: address });
for (const issue of cart.validation_issues ?? []) {
  console.log(`  issue: ${issue.code} - ${issue.user_message}`);
  for (const option of issue.resolution_options ?? []) console.log(`    option: ${option.action} (${option.label})`);
}

// 2. Apply the first option like an agent would: buy what's available.
cart = await call('PUT', `/${cart.id}`, { items: [{ variant_id: 'var_mug_speckled', quantity: 1 }], shipping_address: address });
console.log(`  total: ${cart.totals?.total.value} ${cart.totals?.total.currency_code}`);
console.log(`\nApprove in PayPal sandbox:\n  ${cart.payment_method?.approval_url}\n`);
