import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** An amount as PayPal writes it. */
export type Money = {
  currencyCode: string;
  value: string;
};

export const moneySchema: Schema<Money> = s.object<Money>({
  currencyCode: s.string(),
  value: s.string(),
  _keysMap: {
    currencyCode: "currency_code",
  },
});
