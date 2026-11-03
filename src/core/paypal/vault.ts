// PayPal Payment Method Tokens (Vault v3): the buyer approves once in PayPal, and Sayso gets a token it
// can pay with later without sending them anywhere. Saved without a purchase, as PayPal recommends.

import type { PayPalClient } from './client.ts';
import type { PayPalLink } from './orders.ts';

export interface SetupToken {
  id: string;
  status: string;
  customer?: { id: string };
  links: PayPalLink[];
}

export interface PaymentToken {
  id: string;
  customer?: { id: string };
  payment_source?: { paypal?: { email_address?: string; payer_id?: string } };
}

/** Step 1: a setup token. The buyer approves it at the returned `approve` link. */
export const createSetupToken = (client: PayPalClient, input: { description: string; brandName: string; returnUrl: string; cancelUrl: string }, idempotencyKey: string) =>
  client.post<SetupToken>(
    '/v3/vault/setup-tokens',
    {
      payment_source: {
        paypal: {
          description: input.description.slice(0, 127),
          usage_pattern: 'IMMEDIATE',
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: false,
          experience_context: {
            brand_name: input.brandName.slice(0, 127),
            shipping_preference: 'NO_SHIPPING',
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
    idempotencyKey,
  );

export const getSetupToken = (client: PayPalClient, id: string) => client.get<SetupToken>(`/v3/vault/setup-tokens/${encodeURIComponent(id)}`);

/** Step 2: once approved, turn the setup token into a payment token Sayso can pay with. */
export const createPaymentToken = (client: PayPalClient, setupTokenId: string, idempotencyKey: string) =>
  client.post<PaymentToken>('/v3/vault/payment-tokens', { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } }, idempotencyKey);

/** The buyer disconnects: PayPal forgets the token. */
export const deletePaymentToken = (client: PayPalClient, id: string) => client.delete(`/v3/vault/payment-tokens/${encodeURIComponent(id)}`);

export function approveLink(token: SetupToken): string | undefined {
  return token.links.find((l) => l.rel === 'approve')?.href;
}
