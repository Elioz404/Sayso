// The browser that set up a buyer's saved PayPal. A wallet's id is in its links (they get shared, they
// end up in logs), so the id alone only shows the setup page: seeing which PayPal account is saved,
// finishing the connection and disconnecting need this signed, httpOnly cookie from the browser that
// started it.
import 'server-only';
import { cookies } from 'next/headers';
import { HttpError } from '@/core/errors.ts';
import { ready } from './context.ts';

const PURPOSE = 'wallet-holder';
const TTL_MS = 365 * 86_400_000;
const name = (walletId: string) => `sayso_wallet_${walletId}`;

/** This browser set up `walletId`. */
export async function rememberWallet(walletId: string): Promise<void> {
  const token = (await ready()).access.signValue(PURPOSE, walletId, TTL_MS);
  (await cookies()).set(name(walletId), token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.floor(TTL_MS / 1000) });
}

/** Whether this browser set up `walletId`. */
export async function holdsWallet(walletId: string): Promise<boolean> {
  return (await ready()).access.verifyValue(PURPOSE, (await cookies()).get(name(walletId))?.value) === walletId;
}

export async function requireWalletHolder(walletId: string): Promise<void> {
  if (!(await holdsWallet(walletId))) throw new HttpError(403, 'Open this from the browser where you set up your saved PayPal.');
}
