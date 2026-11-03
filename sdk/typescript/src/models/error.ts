import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Error = {
  name: string;
  message: string;
  /** PayPal's debug id */
  debugId?: string;
};

export const errorSchema: Schema<Error> = s.object<Error>({
  name: s.string(),
  message: s.string(),
  debugId: s.optional(s.string()),
  _keysMap: {
    debugId: "debug_id",
  },
});
