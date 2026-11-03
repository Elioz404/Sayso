// Money helpers. Amounts are kept as integer minor units (cents) internally and converted to the
// decimal-string format PayPal's APIs use ("25.00") only at the edges, so no float ever touches a total.

/** PayPal's wire format for an amount: ISO-4217 code plus a decimal string. */
export interface Money {
  currency_code: string;
  value: string;
}

// Currencies PayPal accepts without decimals.
const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** Integer minor units -> PayPal Money. */
export function toMoney(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) throw new Error(`Amount must be integer minor units, got ${minor}`);
  const decimals = decimalsFor(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (decimals === 0) return { currency_code: currency, value: `${sign}${abs}` };
  const units = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return { currency_code: currency, value: `${sign}${units}.${cents}` };
}

/** PayPal Money -> integer minor units. Rejects malformed values instead of guessing. */
export function toMinor(money: Money): number {
  const decimals = decimalsFor(money.currency_code);
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(money.value.trim());
  if (!match) throw new Error(`Invalid money value "${money.value}"`);
  const [, neg, units, frac = ''] = match;
  if (decimals === 0 && frac) throw new Error(`${money.currency_code} has no decimals: "${money.value}"`);
  const minor = Number(units) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || 0);
  return neg ? -minor : minor;
}

/** Human-readable amount for UIs, audit messages and agent replies. */
export function formatMoney(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minor / 10 ** decimals);
}

/** Basis points (1/100 of a percent) applied to an amount, rounded half-up. */
export function applyBps(minor: number, bps: number): number {
  return Math.round((minor * bps) / 10_000);
}
