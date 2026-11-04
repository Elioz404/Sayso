// Every public URL Sayso hands to people and agents, built in one place from the server's base URL.
// Pages, emails, tool results and the CLI hints all use these, so a route change is a one-line edit.

export interface Links {
  base: string;
  /** A full URL for an asset given as a path on this site (/photos/mug.webp); full URLs pass through. */
  asset(url: string): string;
  /** A seller's uploaded photo, as a path on this site. */
  media(id: string): string;
  /** Every shop, for any shopping assistant. */
  shoppingMcp: string;
  /** Every shop plus the buyer's saved PayPal. */
  shoppingMcpFor(walletKey: string): string;
  /** One shop's own buyer endpoint. */
  shopMcp(slug: string): string;
  /** PayPal's Agentic Commerce merchant-cart API for one shop. */
  merchantCart(slug: string): string;
  /** The REST API described for code generators. */
  openApi: string;
  /** The developer portal APIMatic generates from that description. */
  developers: string;
  /** The owner's agent, with the key in a header. */
  sellerMcp: string;
  /** The owner's agent through a personal URL. */
  sellerMcpFor(agentKey: string): string;
  cliLogin(agentKey: string): string;
  /** Starts Log in with PayPal for an owner. */
  paypalSignIn: string;
  /** Where PayPal sends the owner back; registered as a return URL in the PayPal app. */
  paypalSignInReturn: string;
  /** Where PayPal sends the owner back after connecting their account for payouts. */
  payoutsReturn: string;
  shopPage(slug: string): string;
  productPage(slug: string, productId: string): string;
  approve(recordId: string): string;
  /** The owner's screens. */
  owner: { home: string; orders: string; catalog: string; addProduct: string; phone: string };
  /** Opens the shop on another device; the token rides in the fragment, which never reaches a server log. */
  handoff(token: string): string;
  wallet(walletId: string): string;
  walletReturn(walletId: string): string;
  walletCancelled(walletId: string): string;
  payReturn(cartId: string): string;
  payCancel(cartId: string): string;
}

export function links(baseUrl: string): Links {
  const base = baseUrl.replace(/\/$/, '');
  return {
    base,
    asset: (url) => (url.startsWith('/') ? `${base}${url}` : url),
    media: (id) => `/media/${id}`,
    shoppingMcp: `${base}/api/shopping/mcp`,
    shoppingMcpFor: (key) => `${base}/api/shopping/mcp/${key}`,
    shopMcp: (slug) => `${base}/api/shops/${slug}/mcp`,
    merchantCart: (slug) => `${base}/api/shops/${slug}/merchant-cart`,
    openApi: `${base}/openapi.yaml`,
    developers: `${base}/developers`,
    sellerMcp: `${base}/api/mcp`,
    sellerMcpFor: (key) => `${base}/api/mcp/${key}`,
    cliLogin: (key) => `node cli/sayso.ts login --url ${base} --key ${key}`,
    paypalSignIn: `${base}/api/owner/paypal/start`,
    paypalSignInReturn: `${base}/api/owner/paypal/callback`,
    payoutsReturn: `${base}/api/owner/payouts/return`,
    shopPage: (slug) => `${base}/shop/${slug}`,
    productPage: (slug, productId) => `${base}/shop/${slug}/${productId}`,
    approve: (id) => `${base}/approve/${id}`,
    owner: { home: `${base}/owner`, orders: `${base}/owner/orders`, catalog: `${base}/owner/catalog`, addProduct: `${base}/owner/catalog/new`, phone: `${base}/owner/phone` },
    handoff: (token) => `${base}/handoff#${token}`,
    wallet: (id) => `${base}/wallet/${id}`,
    walletReturn: (id) => `${base}/wallet/${id}/return`,
    walletCancelled: (id) => `${base}/wallet/${id}?cancelled=1`,
    payReturn: (cartId) => `${base}/pay/return?cart=${cartId}`,
    payCancel: (cartId) => `${base}/pay/cancel?cart=${cartId}`,
  };
}
