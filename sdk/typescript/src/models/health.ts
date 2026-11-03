import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { storageSchema, type Storage } from "./storage.js";

export type Health = {
  ok: boolean;
  storage?: Storage;
  ai?: string;
};

export const healthSchema: Schema<Health> = s.object<Health>({
  ok: s.boolean(),
  storage: s.optional(s.lazy(() => storageSchema)),
  ai: s.optional(s.string()),
});
