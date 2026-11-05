// PayPal webhooks: proving an event came from PayPal before anything reads it. PayPal signs
// "<transmission id>|<transmission time>|<webhook id>|<CRC32 of the raw body>" with SHA256withRSA, and
// says where its certificate is. The signature is checked here, against the raw body exactly as it
// arrived, with the certificate fetched only from PayPal's own hosts.
//
// Events from PayPal's Webhooks Simulator are signed with the literal webhook id "WEBHOOK_ID". They are
// accepted only when the server says so (sandbox testing), and even then they only ever point Sayso at
// resources it reads back from PayPal itself: an event is a hint, never the truth about money.

import { verify as verifySignature, X509Certificate, type KeyObject } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** The webhook id PayPal's simulator signs with. */
export const SIMULATOR_WEBHOOK_ID = 'WEBHOOK_ID';
/** PayPal resends an event for up to three days; an older transmission is not taken. */
const MAX_AGE_MS = 4 * 86_400_000;

/** One webhook event as PayPal sends it (only what Sayso reads). */
export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  create_time?: string;
  summary?: string;
  resource: Record<string, unknown>;
}

/** The signature headers of one delivery. */
export interface Transmission {
  id: string;
  time: string;
  certUrl: string;
  signature: string;
  algorithm: string;
}

/** The signature headers, or undefined if any is missing (then it isn't PayPal's). */
export function transmissionOf(header: (name: string) => string | null): Transmission | undefined {
  const id = header('paypal-transmission-id');
  const time = header('paypal-transmission-time');
  const certUrl = header('paypal-cert-url');
  const signature = header('paypal-transmission-sig');
  const algorithm = header('paypal-auth-algo') ?? 'SHA256withRSA';
  return id && time && certUrl && signature ? { id, time, certUrl, signature, algorithm } : undefined;
}

/** Only PayPal's own hosts, over https, may hand out the certificate that proves a signature. */
export function isPayPalCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

export interface WebhookVerifierOptions {
  /** The id PayPal gave the webhook when it was created for this app (developer dashboard). */
  webhookId: string;
  /** Also accept events from PayPal's Webhooks Simulator (sandbox only). */
  acceptSimulator?: boolean;
  /** The public key in the certificate at `url`. Default: fetched from PayPal and kept. */
  publicKey?: (url: string) => Promise<KeyObject>;
  now?: () => number;
}

export type Verified = { from: 'webhook' | 'simulator'; event: WebhookEvent };

export class WebhookVerifier {
  private readonly options: WebhookVerifierOptions;
  private readonly keys = new Map<string, Promise<KeyObject>>();

  constructor(options: WebhookVerifierOptions) {
    this.options = options;
  }

  /**
   * The event, if PayPal signed exactly this body for this webhook (or for the simulator, when allowed).
   * Undefined for anything else: a missing header, a foreign certificate, a stale or altered delivery.
   */
  async verify(rawBody: string, transmission: Transmission | undefined): Promise<Verified | undefined> {
    if (!transmission || transmission.algorithm !== 'SHA256withRSA' || !isPayPalCertUrl(transmission.certUrl)) return undefined;
    const sent = Date.parse(transmission.time);
    const now = this.options.now?.() ?? Date.now();
    if (Number.isNaN(sent) || Math.abs(now - sent) > MAX_AGE_MS) return undefined;

    const key = await this.publicKey(transmission.certUrl).catch(() => undefined);
    if (!key) return undefined;
    const body = Buffer.from(rawBody, 'utf8');
    const signature = Buffer.from(transmission.signature, 'base64');
    const signedFor = (webhookId: string) => verifySignature('sha256', Buffer.from(`${transmission.id}|${transmission.time}|${webhookId}|${crc32(body)}`), key, signature);

    const from = signedFor(this.options.webhookId) ? 'webhook' : this.options.acceptSimulator && signedFor(SIMULATOR_WEBHOOK_ID) ? 'simulator' : undefined;
    if (!from) return undefined;
    const event = parseEvent(rawBody);
    return event && { from, event };
  }

  private publicKey(url: string): Promise<KeyObject> {
    if (this.options.publicKey) return this.options.publicKey(url);
    let key = this.keys.get(url);
    if (!key) {
      key = fetchCertificateKey(url);
      key.catch(() => this.keys.delete(url)); // a failed download is tried again next time
      this.keys.set(url, key);
    }
    return key;
  }
}

async function fetchCertificateKey(url: string): Promise<KeyObject> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!res.ok) throw new Error(`PayPal certificate ${res.status}`);
  const cert = new X509Certificate(await res.text());
  const now = Date.now();
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now) throw new Error('PayPal certificate is not valid now');
  return cert.publicKey;
}

function parseEvent(rawBody: string): WebhookEvent | undefined {
  try {
    const event = JSON.parse(rawBody) as Partial<WebhookEvent>;
    if (typeof event.id !== 'string' || typeof event.event_type !== 'string' || !event.resource || typeof event.resource !== 'object') return undefined;
    return event as WebhookEvent;
  } catch {
    return undefined;
  }
}
