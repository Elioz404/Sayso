// Masks buyers' personal details for people who aren't the shop's owner: the shared public demo session
// and the demo agent key everyone trying the demo gets. Emails keep their first letter and domain, so
// the story still reads; street lines and postcodes are hidden, the town and country stay.

const EMAIL = /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const HIDDEN_FIELDS = new Set(['address_line_1', 'address_line_2', 'postal_code', 'phone', 'payer_id']);

export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, (_all, first: string, domain: string) => `${first}***@${domain}`);
}

/** A copy of any JSON-like value with personal details masked everywhere in it. */
export function maskDeep<T>(value: T): T {
  return mask(value) as T;
}

function mask(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key && HIDDEN_FIELDS.has(key) ? '•••' : maskPersonalData(value);
  if (Array.isArray(value)) return value.map((v) => mask(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, k)]));
  return value;
}
