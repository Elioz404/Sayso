import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ErrorError = {
  name: string;
  message: string;
  /** PayPal's debug id */
  debugId?: string;
};

export const errorErrorSchema: Schema<ErrorError> = s.object<ErrorError>({
  name: s.string(),
  message: s.string(),
  debugId: s.optional(s.string()),
  _keysMap: {
    debugId: "debug_id",
  },
});
