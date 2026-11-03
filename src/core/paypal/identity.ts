// Log in with PayPal (OpenID Connect): how a seller signs in to Sayso with the PayPal account they
// sell with, instead of a secret they could lose. PayPal authenticates the person; Sayso only keeps who
// they are (a stable user id, the payer id their sales can go to, a verified email).

import type { PayPalClient } from './client.ts';

/** openid: who they are; email: where to reach them; paypalattributes: their payer id and verification. */
const SCOPES = 'openid email https://uri.paypal.com/services/paypalattributes';

export interface PayPalIdentity {
  /** Stable for this person and this app; what Sayso keys sellers by. */
  userId: string;
  /** The PayPal account id (a merchant id for business accounts). */
  payerId?: string;
  email?: string;
  name?: string;
  /** PayPal has verified the account. */
  verified: boolean;
}

interface UserInfo {
  user_id: string;
  payer_id?: string;
  name?: string;
  emails?: { value: string; primary?: boolean; confirmed?: boolean }[];
  verified_account?: boolean | string;
}

/** Where to send the seller to sign in. `state` comes back unchanged and must be checked. */
export function signInUrl(client: PayPalClient, redirectUri: string, state: string): string {
  const query = new URLSearchParams({ flowEntry: 'static', client_id: client.clientId, response_type: 'code', scope: SCOPES, redirect_uri: redirectUri, state });
  return `${client.webBase}/signin/authorize?${query}`;
}

/** After PayPal redirects back with `code`: who signed in. The code works once. */
export async function identityFromCode(client: PayPalClient, code: string, redirectUri: string): Promise<PayPalIdentity> {
  const token = await client.userAccessToken(code, redirectUri);
  const info = await client.getAsUser<UserInfo>('/v1/identity/oauth2/userinfo?schema=paypalv1.1', token);
  const email = info.emails?.find((e) => e.primary) ?? info.emails?.[0];
  return {
    userId: info.user_id,
    payerId: info.payer_id,
    email: email?.value,
    name: info.name,
    verified: info.verified_account === true || info.verified_account === 'true',
  };
}
