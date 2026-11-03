import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const Storage = {
  Memory: "memory",
  Postgres: "postgres",
} as const;
export type Storage = (typeof Storage)[keyof typeof Storage] | (string & {});

export const storageSchema: EnumSchema<Storage> = s.enumOf<Storage>(Storage);
