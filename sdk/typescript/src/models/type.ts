import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const Type = {
  MissingField: "MISSING_FIELD",
  InvalidData: "INVALID_DATA",
  BusinessRule: "BUSINESS_RULE",
} as const;
export type Type = (typeof Type)[keyof typeof Type] | (string & {});

export const typeSchema: EnumSchema<Type> = s.enumOf<Type>(Type);
