import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { status1Schema, type Status1 } from "./status1.js";

export type Shop = {
  slug: string;
  name: string;
  currency: string;
  shipsFrom: string;
  status: Status1;
};

export const shopSchema: Schema<Shop> = s.object<Shop>({
  slug: s.string(),
  name: s.string(),
  currency: s.string(),
  shipsFrom: s.string(),
  status: status1Schema,
  _keysMap: {
    shipsFrom: "ships_from",
  },
});
