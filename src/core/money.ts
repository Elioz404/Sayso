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
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: "${money.value}"`);
  return neg ? -minor : minor;
}

/** The currency used when nothing else says which: new buyer wallets and demo defaults. */
export const DEFAULT_CURRENCY = 'USD';

/** Whole units of a currency (e.g. 50 dollars, 5000 yen) -> minor units. For defaults written in code. */
export function majorUnits(units: number, currency: string): number {
  return units * 10 ** decimalsFor(currency);
}

const THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * The one lenient parser for amounts typed by people or produced by models: "$1,250.50", "62", 62.
 * Returns minor units, or undefined for anything ambiguous or invalid: negatives, a decimal comma
 * ("12,50" could mean 12.50 or 1250), more decimals than the currency has, or unsafe numbers.
 */
export function parseAmount(input: string | number, currency: string): number | undefined {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return undefined;
    text = input.toFixed(decimalsFor(currency));
    if (Number(text) !== input) return undefined; // 24.555 has a fraction of a cent: refuse, never round
  } else {
    text = input.trim().replace(/^[$€£¥]\s*/, '').replace(new RegExp(`\\s*${currency}$`, 'i'), '');
    if (THOUSANDS.test(text)) text = text.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  }
  try {
    return toMinor({ currency_code: currency, value: text });
  } catch {
    return undefined;
  }
}

/** The sign written before an amount ("$", "€"), or the code itself where there is none. */
export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
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
