// PayPal partner onboarding (Partner Referrals): how a shop owner connects their own PayPal so sales are
// paid straight to them. Sayso asks PayPal for a sign-up link; the owner signs in to PayPal there and
// grants Sayso permission to take payments for them and to refund them. Afterwards Sayso asks PayPal,
// never the browser, which account connected and what it allowed.

import type { PayPalClient } from './client.ts';

/** What Sayso asks the owner to allow: charging buyers for them, and refunding those sales. */
const FEATURES = ['PAYMENT', 'REFUND'];
const REQUIRED_SCOPES = ['https://uri.paypal.com/services/payments/payment/authcapture', 'https://uri.paypal.com/services/payments/refund'];

export interface SellerIntegration {
  merchantId: string;
  /** PayPal can pay this account (it is set up to receive money). */
  paymentsReceivable: boolean;
  emailConfirmed: boolean;
  /** The owner granted everything Sayso needs: taking payments for them and refunding them. */
  permissionsGranted: boolean;
}

interface Integration {
  merchant_id: string;
  payments_receivable?: boolean;
  primary_email_confirmed?: boolean;
  oauth_integrations?: { integration_type?: string; oauth_third_party?: { partner_client_id?: string; scopes?: string[] }[] }[];
}

/** A PayPal sign-up link for this shop. `trackingId` comes back on the account PayPal links. */
export async function referralLink(client: PayPalClient, input: { trackingId: string; returnUrl: string }, idempotencyKey: string): Promise<string> {
  const res = await client.post<{ links: { rel: string; href: string }[] }>(
    '/v2/customer/partner-referrals',
    {
      tracking_id: input.trackingId,
      operations: [
        {
          operation: 'API_INTEGRATION',
          api_integration_preference: { rest_api_integration: { integration_method: 'PAYPAL', integration_type: 'THIRD_PARTY', third_party_details: { features: FEATURES } } },
        },
      ],
      products: ['EXPRESS_CHECKOUT'],
      legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
      partner_config_override: { return_url: input.returnUrl },
    },
    idempotencyKey,
  );
  const href = res.links.find((l) => l.rel === 'action_url')?.href;
  if (!href) throw new Error('PayPal returned no sign-up link');
  return href;
}

/** The account that completed `trackingId`'s sign-up, or undefined if none has yet. */
export async function connectedSeller(client: PayPalClient, partnerMerchantId: string, trackingId: string): Promise<SellerIntegration | undefined> {
  const found = await client
    .get<{ merchant_id?: string }>(`/v1/customer/partners/${partnerMerchantId}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`)
    .catch((err: { status?: number }): { merchant_id?: string } => {
      if (err.status === 404) return {}; // nobody has finished this sign-up yet
      throw err;
    });
  if (!found.merchant_id) return undefined;

  const details = await client.get<Integration>(`/v1/customer/partners/${partnerMerchantId}/merchant-integrations/${found.merchant_id}`);
  const scopes = new Set(
    (details.oauth_integrations ?? [])
      .filter((o) => o.integration_type === 'OAUTH_THIRD_PARTY')
      .flatMap((o) => o.oauth_third_party ?? [])
      .filter((t) => t.partner_client_id === client.clientId)
      .flatMap((t) => t.scopes ?? []),
  );
  return {
    merchantId: details.merchant_id,
    paymentsReceivable: details.payments_receivable === true,
    emailConfirmed: details.primary_email_confirmed === true,
    permissionsGranted: REQUIRED_SCOPES.every((s) => scopes.has(s)),
  };
}
