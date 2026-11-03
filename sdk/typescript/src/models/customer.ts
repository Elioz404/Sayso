import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { nameSchema, type Name } from "./name.js";

export type Customer = {
  emailAddress?: string;
  phone?: string;
  name?: Name;
};

export const customerSchema: Schema<Customer> = s.object<Customer>({
  emailAddress: s.optional(s.string()),
  phone: s.optional(s.string()),
  name: s.optional(s.lazy(() => nameSchema)),
  _keysMap: {
    emailAddress: "email_address",
  },
});
