import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ShopSummary = {
  /** The slug to use in other calls */
  shop: string;
  name: string;
  shipsFrom: string;
  currency: string;
  sells: string[];
  /** How many products it has */
  products: number;
};

export const shopSummarySchema: Schema<ShopSummary> = s.object<ShopSummary>({
  shop: s.string(),
  name: s.string(),
  shipsFrom: s.string(),
  currency: s.string(),
  sells: s.array(s.string()),
  products: s.int(),
  _keysMap: {
    shipsFrom: "ships_from",
  },
});
