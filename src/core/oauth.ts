// OAuth 2.1 for the owner's own agents (MCP authorization). An AI app such as ChatGPT or Claude is given
// one public address (the seller MCP endpoint). It finds out how to sign in from the metadata below,
// registers itself (dynamic client registration), sends the owner to Sayso to allow it, and trades the
// code it gets back (with PKCE) for an agent key of its own: the same kind of key the owner can make by
// hand, listed under Agents and revoked there. Nothing is copied by hand and no secret leaves Sayso
// except to the app the owner allowed.
//
// Stateless on purpose: a registered client, a consent request and a code are signed values. Codes are
// single-use and live five minutes.

import { createHash, randomBytes } from 'node:crypto';
import type { Access } from './access.ts';
import type { Links } from './links.ts';

/** The one scope there is: run the owner's shop, within its rules. */
export const SCOPE = 'shop';

const CLIENT = 'oauth-client';
const REQUEST = 'oauth-request';
const CODE = 'oauth-code';
const CLIENT_TTL_MS = 5 * 365 * 86_400_000;
const REQUEST_TTL_MS = 15 * 60_000;
const CODE_TTL_MS = 5 * 60_000;

/** An OAuth error as RFC 6749 names it; `redirect` errors go back to the app, the others show on Sayso's page. */
export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
  body() {
    return { error: this.code, error_description: this.message };
  }
}

export interface OAuthClient {
  /** As the app named itself ("Claude", "ChatGPT"). */
  name?: string;
  redirectUris: string[];
}

/** What the app asked for, carried from /oauth/authorize through sign-in to the owner's answer. */
export interface ConsentRequest {
  clientId: string;
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

/** RFC 9728: where the seller MCP endpoint's authorization server is. */
export function resourceMetadata(links: Links) {
  return { resource: links.sellerMcp, authorization_servers: [links.base], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Sayso' };
}

/** RFC 8414: what Sayso's authorization server supports. */
export function serverMetadata(links: Links) {
  return {
    issuer: links.base,
    authorization_endpoint: `${links.base}/oauth/authorize`,
    token_endpoint: `${links.base}/api/oauth/token`,
    registration_endpoint: `${links.base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  };
}

/** The `WWW-Authenticate` value a 401 from the seller MCP endpoint carries, so apps can find the above. */
export function challengeHeader(links: Links, invalidToken = false): string {
  const where = `resource_metadata="${links.base}/.well-known/oauth-protected-resource/api/mcp"`;
  return invalidToken ? `Bearer error="invalid_token", ${where}` : `Bearer ${where}`;
}

/** RFC 7591: an app registers itself. Its client id is the signed registration, so nothing is stored. */
export function registerClient(access: Access, body: unknown, now = Date.now()) {
  const input = (body ?? {}) as Record<string, unknown>;
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every((u) => typeof u === 'string' && redirectAllowed(u))) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris: one to five https URLs (or http loopback addresses for apps on this computer)');
  }
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none') {
    throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none", with PKCE) are supported');
  }
  const name = typeof input.client_name === 'string' ? cleanName(input.client_name) : undefined;
  const client: OAuthClient = { ...(name ? { name } : {}), redirectUris: uris as string[] };
  const clientId = access.signValue(CLIENT, encode(client), CLIENT_TTL_MS, now);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    ...(name ? { client_name: name } : {}),
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPE,
  };
}

/** The registered app behind a client id, or undefined if Sayso didn't issue it. */
export function clientOf(access: Access, clientId: unknown, now = Date.now()): OAuthClient | undefined {
  const value = access.verifyValue(CLIENT, clientId, now);
  return value ? decode<OAuthClient>(value) : undefined;
}

/**
 * Check an authorization request. A bad client or redirect URI is shown on Sayso's page (it must never
 * send the owner to an address the app didn't register); anything else goes back to the app as an error.
 */
export function checkAuthorize(access: Access, links: Links, params: URLSearchParams, now = Date.now()): { request: ConsentRequest } | { redirect: string } {
  const clientId = params.get('client_id') ?? '';
  const client = clientOf(access, clientId, now);
  if (!client) throw new OAuthError('invalid_client', 'This app is not registered with Sayso. Remove the connector in the app and add it again.');
  const redirectUri = params.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!client.redirectUris.includes(redirectUri)) throw new OAuthError('invalid_request', 'The app sent an address it did not register.');
  const state = params.get('state') ?? undefined;
  const back = (error: string, description: string) => ({ redirect: withParams(redirectUri, { error, error_description: description, state, iss: links.base }) });

  if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code');
  const codeChallenge = params.get('code_challenge') ?? '';
  if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return back('invalid_request', 'PKCE with S256 is required');
  const resource = params.get('resource');
  if (resource && resource.replace(/\/$/, '') !== links.sellerMcp) return back('invalid_target', `The resource is ${links.sellerMcp}`);
  const scope = params.get('scope');
  if (scope && !scope.split(' ').every((s) => s === SCOPE || s === 'offline_access')) return back('invalid_scope', `The only scope is "${SCOPE}"`);
  return { request: { clientId, client, redirectUri, codeChallenge, ...(state ? { state } : {}) } };
}

/** The consent request as a path segment: survives the owner signing in on the way (letters, digits, - and _ only). */
export function packRequest(access: Access, request: ConsentRequest, now = Date.now()): string {
  return Buffer.from(access.signValue(REQUEST, encode(request), REQUEST_TTL_MS, now)).toString('base64url');
}

export function unpackRequest(access: Access, packed: string, now = Date.now()): ConsentRequest | undefined {
  if (!/^[A-Za-z0-9_-]{20,8000}$/.test(packed)) return undefined;
  const value = access.verifyValue(REQUEST, Buffer.from(packed, 'base64url').toString('utf8'), now);
  return value ? decode<ConsentRequest>(value) : undefined;
}

/** The owner allowed it: a one-time code for this app, this shop and this PKCE challenge, back to the app. */
export function allow(access: Access, links: Links, request: ConsentRequest, shopId: string, now = Date.now()): string {
  const code = access.signValue(
    CODE,
    encode({ c: hash(request.clientId), r: request.redirectUri, p: request.codeChallenge, s: shopId, n: request.client.name, k: randomBytes(12).toString('base64url') }),
    CODE_TTL_MS,
    now,
  );
  return withParams(request.redirectUri, { code, state: request.state, iss: links.base });
}

/** The owner said no. */
export function deny(links: Links, request: ConsentRequest): string {
  return withParams(request.redirectUri, { error: 'access_denied', error_description: 'The shop owner did not allow it', state: request.state, iss: links.base });
}

/** RFC 6749 token request: a code (once, with its PKCE verifier) for an agent key named after the app. */
export async function exchangeCode(access: Access, form: Record<string, string | undefined>, now = Date.now()) {
  if (form.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code; the key does not expire, so there is nothing to refresh');
  const value = access.verifyValue(CODE, form.code, now);
  const code = value ? decode<{ c: string; r: string; p: string; s: string; n?: string; k: string }>(value) : undefined;
  if (!code) throw new OAuthError('invalid_grant', 'The code is wrong or more than five minutes old');
  if (!form.client_id || hash(form.client_id) !== code.c) throw new OAuthError('invalid_grant', 'The code was issued to another app');
  if (form.redirect_uri !== undefined && form.redirect_uri !== code.r) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  const verifier = form.code_verifier ?? '';
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== code.p) {
    throw new OAuthError('invalid_grant', 'The PKCE code_verifier does not match');
  }
  if (!(await access.consumeOnce(`oauth-code:${code.k}`, new Date(now + CODE_TTL_MS)))) throw new OAuthError('invalid_grant', 'The code was already used');
  const { secret } = await access.createAgentKey(code.s, code.n ?? 'AI app');
  return { access_token: secret, token_type: 'Bearer', scope: SCOPE };
}

/** https anywhere; plain http only back to this computer (apps that sign in through a local port). */
function redirectAllowed(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function cleanName(name: string): string | undefined {
  const clean = name.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 40);
  return clean || undefined;
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = <T,>(value: string): T | undefined => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
};
const hash = (value: string) => createHash('sha256').update(value).digest('base64url').slice(0, 22);
