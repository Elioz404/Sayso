// What a cart request may contain, checked once at the core boundary: the merchant-cart REST routes
// and the buyer tools both land in Commerce, so neither can store an oversized or malformed cart.

import { HttpError } from '../errors.ts';
import { address, customer, items } from '../tools/args.ts';
import { validate, type JsonSchema } from '../tools/schema.ts';
import type { PayPalCart } from './spec.ts';

/**
 * The fields a buyer (or the PayPal platform) sends; everything else in a cart is computed by Sayso.
 * Lines are capped like the tools' (20), but may be empty: a checkout call sends none.
 */
const cartInput: JsonSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', maxItems: 20, items: (items as Extract<JsonSchema, { type: 'array' }>).items },
    customer,
    shipping_address: address,
    billing_address: address,
    payment_method: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['paypal'] }, token: { type: 'string', maxLength: 100 }, payer_id: { type: 'string', maxLength: 100 } },
    },
  },
};

/** A cart body, checked against the spec's limits (at most 20 lines, bounded strings). */
export function parseCartInput(value: unknown): PayPalCart {
  const errors = validate(cartInput, value, 'cart');
  if (errors.length) {
    const message = errors.slice(0, 3).join('; ');
    throw new HttpError(400, message, { name: 'INVALID_REQUEST', message, details: errors.slice(0, 10) });
  }
  const cart = value as PayPalCart;
  return { ...cart, items: Array.isArray(cart.items) ? cart.items : [] };
}
