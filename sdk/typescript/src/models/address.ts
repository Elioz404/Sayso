import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type Address = {
  addressLine1?: string;
  addressLine2?: string;
  /** City */
  adminArea2?: string;
  /** State or province code */
  adminArea1?: string;
  postalCode?: string;
  /** ISO-3166 alpha-2 */
  countryCode: string;
};

export const addressSchema: Schema<Address> = s.object<Address>({
  addressLine1: s.optional(s.string()),
  addressLine2: s.optional(s.string()),
  adminArea2: s.optional(s.string()),
  adminArea1: s.optional(s.string()),
  postalCode: s.optional(s.string()),
  countryCode: s.string(),
  _keysMap: {
    addressLine1: "address_line_1",
    addressLine2: "address_line_2",
    adminArea2: "admin_area_2",
    adminArea1: "admin_area_1",
    postalCode: "postal_code",
    countryCode: "country_code",
  },
});
