import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { productSchema, type Product } from "./product.js";
import { shippingMethodSchema, type ShippingMethod } from "./shipping-method.js";
import { shopSchema, type Shop } from "./shop.js";

export type ShopOffer = {
  shop: Shop;
  products: Product[];
  shipping: ShippingMethod[];
  returns: string;
};

export const shopOfferSchema: Schema<ShopOffer> = s.object<ShopOffer>({
  shop: shopSchema,
  products: s.array(s.lazy(() => productSchema)),
  shipping: s.array(s.lazy(() => shippingMethodSchema)),
  returns: s.string(),
});
