import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_TTL_MS, type OwnerSession } from '@/core/access.ts';
import { isLive, type Catalog } from '@/core/catalog.ts';
import { ConfigError, HttpError, notFound } from '@/core/errors.ts';
import { check, type Infer, type JsonSchema } from '@/core/tools/schema.ts';
import { PayPalError } from '@/core/paypal/client.ts';
import { ready, siteLinks } from './context.ts';
import { logError } from './log.ts';

export const OWNER_COOKIE = 'sayso_owner';

/** The signed-in owner's session, if any. Agent keys never produce one. */
export async function ownerSession(): Promise<OwnerSession | undefined> {
  const { access } = await ready();
  return access.verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
}

/** Sign this browser in as `shopId`'s owner, for a week unless `expires` says otherwise. */
export async function startOwnerSession(shopId: string, options: { kind?: OwnerSession['kind']; via?: OwnerSession['via']; expires?: Date } = {}): Promise<void> {
  const { access } = await ready();
  const ttlMs = Math.min(SESSION_TTL_MS, (options.expires?.getTime() ?? Infinity) - Date.now());
  const token = await access.signOwnerSession(shopId, { ttlMs, kind: options.kind, via: options.via });
  (await cookies()).set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });
}

/** Why the shared public demo session can look and decide, but not change the shop. */
export const SHARED_DEMO_READ_ONLY = "The demo shop is shared by everyone trying Sayso, so it can't be changed here. Start the judges' tour for a shop of your own.";

/** The signed-in owner's session for a cookie-authenticated request (cross-site requests are refused). */
export async function requireOwnerSession(request: Request): Promise<OwnerSession> {
  assertSameOrigin(request);
  const session = await ownerSession();
  if (!session) throw new HttpError(401, 'Sign in as the shop owner first');
  return session;
}

/** The owner's shop. The shared demo session passes: it may look and decide. */
export async function requireOwner(request: Request): Promise<string> {
  return (await requireOwnerSession(request)).shopId;
}

/**
 * The owner's own shop, for anything that changes it or ties it to a device (prices, keys, rules,
 * passkeys, notifications...). The shared demo session is refused: every visitor would share the change.
 */
export async function requireOwnShop(request: Request): Promise<OwnerSession> {
  const session = await requireOwnerSession(request);
  if (session.kind === 'demo') throw new HttpError(403, SHARED_DEMO_READ_ONLY);
  return session;
}

/** Owner actions are cookie-authenticated, so refuse cross-site requests outright. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== siteLinks().base) {
    throw new HttpError(403, 'Cross-site request refused');
  }
}

/** The live shop at `slug`, for routes scoped to one shop. */
export async function liveCatalog(slug: string): Promise<Catalog> {
  const catalog = await (await ready()).catalogs.bySlug(slug);
  if (!catalog || !isLive(catalog)) throw notFound(`Shop ${slug}`);
  return catalog;
}

/** A yes/no query parameter: "true" or "1" mean yes. */
export function flag(search: URLSearchParams, name: string): boolean {
  return ['true', '1'].includes(search.get(name)?.toLowerCase() ?? '');
}

/** Who is shopping, as the client says (for the owner's dashboard only; never trusted for access). */
export function channelOf(request: Request, fallback: string): string {
  return request.headers.get('x-sayso-channel')?.trim().slice(0, 40) || fallback;
}

/** Run a route body and map known errors to the JSON shapes the merchant-cart spec expects. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return Response.json(err.body, { status: err.status });
    if (err instanceof PayPalError) {
      logError('paypal', err);
      return Response.json({ name: 'PAYPAL_ERROR', message: err.message, debug_id: err.debugId }, { status: 502 });
    }
    logError('request', err);
    const message = err instanceof ConfigError ? err.message : 'Unexpected error';
    return Response.json({ name: 'INTERNAL_SERVER_ERROR', message }, { status: 500 });
  }
}

/** Bodies most routes accept; routes that take photos raise it. */
export const BODY_LIMIT = 64 * 1024;
export const PHOTO_BODY_LIMIT = 12 * 1024 * 1024;

/**
 * The JSON body, read with a size cap and checked against `schema`, so a route gets typed values or a
 * 400 that says what is wrong, never a crash on a malformed body.
 */
export async function readBody<const S extends JsonSchema>(request: Request, schema: S, limit = BODY_LIMIT): Promise<Infer<S>> {
  const parsed = check(schema, await readJson(request, limit), 'body');
  if (!parsed.ok) throw new HttpError(400, parsed.errors.slice(0, 3).join('; '));
  return parsed.value;
}

/** The JSON body as unknown, refused past `limit` bytes before it is buffered whole. */
export async function readJson(request: Request, limit = BODY_LIMIT): Promise<unknown> {
  const text = await readText(request, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

/** The body as text, read with a size cap: the declared length is checked first, then the bytes as they come. */
export async function readText(request: Request, limit = BODY_LIMIT): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw tooLarge(limit);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, `Request body is over ${Math.round(limit / 1024)} KB`);
}
