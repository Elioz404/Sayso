import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { metadataSchema, type Metadata } from "./metadata.js";

export type ResolutionOption = {
  action: string;
  label: string;
  metadata?: Metadata;
};

export const resolutionOptionSchema: Schema<ResolutionOption> = s.object<ResolutionOption>({
  action: s.string(),
  label: s.string(),
  metadata: s.optional(s.lazy(() => metadataSchema)),
});
