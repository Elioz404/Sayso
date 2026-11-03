import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { moneySchema, type Money } from "./money.js";

export type Metadata = {
  priority?: number;
  autoApplicable?: boolean;
  /** An amount as PayPal writes it. */
  costImpact?: Money;
};

export const metadataSchema: Schema<Metadata> = s.object<Metadata>({
  priority: s.optional(s.int()),
  autoApplicable: s.optional(s.boolean()),
  costImpact: s.optional(s.lazy(() => moneySchema)),
  _keysMap: {
    autoApplicable: "auto_applicable",
    costImpact: "cost_impact",
  },
});
