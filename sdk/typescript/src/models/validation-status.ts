import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const ValidationStatus = {
  Valid: "VALID",
  Invalid: "INVALID",
  RequiresAdditionalInformation: "REQUIRES_ADDITIONAL_INFORMATION",
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus] | (string & {});

export const validationStatusSchema: EnumSchema<ValidationStatus> =
  s.enumOf<ValidationStatus>(ValidationStatus);
