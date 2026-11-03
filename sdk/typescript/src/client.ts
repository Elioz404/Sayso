import type { ClientOptions } from "./client-options.js";
import { buildCoreClientOptions } from "./core/client-options.js";
import { RawClient } from "./core/raw-client.js";
import * as host from "./core/runtime-environment.js";
import * as s from "./core/validation/index.js";
import { MerchantCart } from "./resources/merchant-cart.js";
import { Service } from "./resources/service.js";
import { Shops } from "./resources/shops.js";
import { buildServers, type Servers } from "./servers.js";

/**
 * Buy from small shops on Sayso from any agent platform. Discover shops and products, build a cart
 * with PayPal's Agentic Commerce merchant-cart API, send the buyer to PayPal to approve, then
 * complete the checkout.
 *
 * Money only moves with a say-so: the buyer approves in PayPal, and each shop's Guard checks stock
 * and the owner's rules before anything is captured. If an order can't go through, the PayPal hold
 * is released and the buyer is not charged.
 *
 * Agents that speak MCP can use `/api/shopping/mcp` instead; it offers the same operations as
 * tools.
 */
export class SaysoShopsApiClient {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  #shops?: Shops;
  #merchantCart?: MerchantCart;
  #service?: Service;

  constructor(options: ClientOptions = {}) {
    this.#rawClient = new RawClient({
      ...buildCoreClientOptions(options, "SAYSO_SHOPS_API_CLIENT_LOG"),
      defaultHeaders: [
        { name: "User-Agent", value: "SaysoShopsApiClient/0.3.0 TypeScript", schema: s.string() },
        { name: "X-APIMatic-Lang", value: "TypeScript", schema: s.string() },
        { name: "X-APIMatic-Package-Version", value: "0.3.0", schema: s.string() },
        { name: "X-APIMatic-Gen-Version", value: "4.0.0", schema: s.string() },
        { name: "X-APIMatic-OS", value: host.operatingSystem(), schema: s.optional(s.string()) },
        { name: "X-APIMatic-Runtime", value: host.runtimeDescription(), schema: s.optional(s.string()) },
      ],
      defaultQuery: [],
      defaultPathParams: [],
    });

    this.#servers = buildServers(options);
  }

  /**
   * Find shops and what they sell.
   */
  get shops(): Shops {
    return (this.#shops ??= new Shops(this.#rawClient, this.#servers));
  }

  /**
   * PayPal Agentic Commerce merchant-cart API (v1), one shop at a time.
   */
  get merchantCart(): MerchantCart {
    return (this.#merchantCart ??= new MerchantCart(this.#rawClient, this.#servers));
  }

  /**
   * Is the server up.
   */
  get service(): Service {
    return (this.#service ??= new Service(this.#rawClient, this.#servers));
  }
}
