import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type SelectedAttribute = {
  name?: string;
  value?: string;
};

export const selectedAttributeSchema: Schema<SelectedAttribute> = s.object<SelectedAttribute>({
  name: s.optional(s.string()),
  value: s.optional(s.string()),
});
