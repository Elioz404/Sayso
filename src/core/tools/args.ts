// Argument schemas shared by several tools.

import type { JsonSchema } from './schema.ts';

export const address: JsonSchema = {
  type: 'object',
  description: 'Where the order ships. country_code is ISO-3166 alpha-2.',
  properties: {
    address_line_1: { type: 'string', maxLength: 300 },
    address_line_2: { type: 'string', maxLength: 300 },
    admin_area_2: { type: 'string', description: 'City', maxLength: 120 },
    admin_area_1: { type: 'string', description: 'State or province code, e.g. CA', maxLength: 300 },
    postal_code: { type: 'string', maxLength: 60 },
    country_code: { type: 'string', pattern: '^[A-Z]{2}$' },
  },
  required: ['country_code'],
};

export const customer: JsonSchema = {
  type: 'object',
  description: "The buyer's contact, for the shop's receipt",
  properties: { email_address: { type: 'string', maxLength: 254 } },
};

export const items: JsonSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 20,
  items: {
    type: 'object',
    properties: { variant_id: { type: 'string', maxLength: 80 }, quantity: { type: 'integer', minimum: 1, maximum: 99 } },
    required: ['variant_id', 'quantity'],
  },
};

/** Read by parseAmount in the shop's currency (its decimals, "$1,250"), so the schema only bounds length. */
export const money = { type: 'string', minLength: 1, maxLength: 20, description: 'Amount in the shop currency, e.g. "12.50"' } as const;

export const shopArg = { type: 'string', maxLength: 80, description: "The shop's slug from search_products. Only needed on the all-shops endpoint." } as const;
