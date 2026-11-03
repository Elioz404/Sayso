// Every public URL Sayso hands to people and agents, built in one place from the server's base URL.
// Pages, emails, tool results and the CLI hints all use these, so a route change is a one-line edit.

export interface Links {
  base: string;
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
  /** The owner's agent, with the key in a header. */
  sellerMcp: string;
  /** The owner's agent through a personal URL. */
  sellerMcpFor(agentKey: string): string;
  cliLogin(agentKey: string): string;
  shopPage(slug: string): string;
  approve(recordId: string): string;
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
    shoppingMcp: `${base}/api/shopping/mcp`,
    shoppingMcpFor: (key) => `${base}/api/shopping/mcp/${key}`,
    shopMcp: (slug) => `${base}/api/shops/${slug}/mcp`,
    merchantCart: (slug) => `${base}/api/shops/${slug}/merchant-cart`,
    openApi: `${base}/openapi.yaml`,
    sellerMcp: `${base}/api/mcp`,
    sellerMcpFor: (key) => `${base}/api/mcp/${key}`,
    cliLogin: (key) => `node cli/sayso.ts login --url ${base} --key ${key}`,
    shopPage: (slug) => `${base}/shop/${slug}`,
    approve: (id) => `${base}/approve/${id}`,
    wallet: (id) => `${base}/wallet/${id}`,
    walletReturn: (id) => `${base}/wallet/${id}/return`,
    walletCancelled: (id) => `${base}/wallet/${id}?cancelled=1`,
    payReturn: (cartId) => `${base}/pay/return?cart=${cartId}`,
    payCancel: (cartId) => `${base}/pay/cancel?cart=${cartId}`,
  };
}
