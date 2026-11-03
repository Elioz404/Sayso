import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Name = {
  givenName?: string;
  surname?: string;
};

export const nameSchema: Schema<Name> = s.object<Name>({
  givenName: s.optional(s.string()),
  surname: s.optional(s.string()),
  _keysMap: {
    givenName: "given_name",
  },
});
