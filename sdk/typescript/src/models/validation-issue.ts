import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { codeSchema, type Code } from "./code.js";
import { resolutionOptionSchema, type ResolutionOption } from "./resolution-option.js";
import { typeSchema, type Type } from "./type.js";

export type ValidationIssue = {
  code: Code;
  type: Type;
  message: string;
  userMessage?: string;
  variantId?: string;
  field?: string;
  context?: Record<string, unknown>;
  resolutionOptions?: ResolutionOption[];
};

export const validationIssueSchema: Schema<ValidationIssue> = s.object<ValidationIssue>({
  code: codeSchema,
  type: typeSchema,
  message: s.string(),
  userMessage: s.optional(s.string()),
  variantId: s.optional(s.string()),
  field: s.optional(s.string()),
  context: s.optional(s.record(s.string(), s.unknown())),
  resolutionOptions: s.optional(s.array(s.lazy(() => resolutionOptionSchema))),
  _keysMap: {
    userMessage: "user_message",
    variantId: "variant_id",
    resolutionOptions: "resolution_options",
  },
});
