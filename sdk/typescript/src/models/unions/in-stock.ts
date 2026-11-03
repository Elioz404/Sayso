import * as s from "../../core/validation/index.js";
import type { Schema } from "../../core/validation/schema.js";

/** Units on hand, or a made-to-order lead time */
export type InStock = number | string;

export const inStockSchema: Schema<InStock> = s.of<InStock>(s.union([s.int(), s.string()]));
