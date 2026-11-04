// Parcel tracking, one set of rules for every way it arrives: the owner typing it, a label photo read
// by the model, or the owner's agent calling add_tracking. Plain data and pure functions, so the
// browser can use the same carrier list.

/** PayPal carrier codes Sayso offers, with the name people know them by. */
export const CARRIERS = [
  ['USPS', 'USPS'],
  ['UPS', 'UPS'],
  ['FEDEX', 'FedEx'],
  ['DHL', 'DHL'],
  ['ONTRAC', 'OnTrac'],
  ['CANADA_POST', 'Canada Post'],
  ['ROYAL_MAIL', 'Royal Mail'],
  ['AUSTRALIA_POST', 'Australia Post'],
  ['CORREOS_ES', 'Correos'],
  ['CORREO_ARGENTINO', 'Correo Argentino'],
  ['OTHER', 'Other'],
] as const;

export type Carrier = (typeof CARRIERS)[number][0];

const CODES: readonly string[] = CARRIERS.map(([code]) => code);

/** A carrier code from how it was written ("fedex", "Canada Post"), OTHER for an unknown one, undefined for none. */
export function carrierCode(value: unknown): Carrier | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const code = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const byName = CARRIERS.find(([, name]) => name.toUpperCase().replace(/[\s-]+/g, '_') === code)?.[0];
  return byName ?? (CODES.includes(code) ? (code as Carrier) : 'OTHER');
}

/** A tracking number as printed, without spaces or dashes; undefined if it can't be one. */
export function trackingNumber(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const number = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8,40}$/.test(number) ? number : undefined;
}

/** The carrier's own tracking page for a parcel, when Sayso knows it. */
export function trackingLink(carrier: string, number: string): string | undefined {
  const n = encodeURIComponent(number);
  switch (carrier) {
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'FEDEX':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'DHL':
      return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
    default:
      return undefined;
  }
}

/** A carrier's name as people know it ("FedEx" for FEDEX). */
export function carrierName(code: string): string {
  return CARRIERS.find(([c]) => c === code)?.[1] ?? code;
}
