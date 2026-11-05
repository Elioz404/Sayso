// An AI app (ChatGPT, Claude...) connects to a shop by OAuth: it registers itself, the owner allows it, and
// the code (with PKCE) becomes an agent key named after the app. Nothing else gets a key.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { links } from '../src/core/links.ts';
import { allow, checkAuthorize, clientOf, deny, exchangeCode, OAuthError, packRequest, parseTokenRequest, registerClient, resourceMetadata, serverMetadata, unpackRequest } from '../src/core/oauth.ts';
import { stack } from './stack.ts';

const site = links('https://sayso.test');
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(20) + '-the-apps-own-secret-verifier-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');

function authorizeParams(clientId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: site.sellerMcp, ...extra });
}

test('discovery: the MCP endpoint names Sayso as its authorization server', () => {
  assert.equal(resourceMetadata(site).resource, 'https://sayso.test/api/mcp');
  assert.deepEqual(resourceMetadata(site).authorization_servers, ['https://sayso.test']);
  const server = serverMetadata(site);
  assert.equal(server.registration_endpoint, 'https://sayso.test/api/oauth/register');
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(server.token_endpoint_auth_methods_supported, ['none']);
});

test('an app registers, the owner allows it, and its code becomes an agent key named after it', async () => {
  const s = await stack();
  const registered = registerClient(s.access, { client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' });
  assert.equal(clientOf(s.access, registered.client_id)?.name, 'Claude');

  const checked = checkAuthorize(s.access, site, authorizeParams(registered.client_id));
  const request = unpackRequest(s.access, packRequest(s.access, checked))!;
  assert.equal(request.redirectUri, CALLBACK, 'the request survives the trip through sign-in');

  const back = new URL(allow(s.access, site, request, 'shop_maya'));
  assert.equal(back.origin + back.pathname, CALLBACK);
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('iss'), 'https://sayso.test');
  const code = back.searchParams.get('code')!;

  const wrongVerifier = exchangeCode(s.access, { grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: CALLBACK, code_verifier: 'x'.repeat(43) });
  await assert.rejects(wrongVerifier, (e: OAuthError) => e.code === 'invalid_grant');
  const other = registerClient(s.access, { client_name: 'Someone else', redirect_uris: [CALLBACK] });
  await assert.rejects(exchangeCode(s.access, { grant_type: 'authorization_code', code, client_id: other.client_id, code_verifier: verifier }), /another app/);

  const token = await exchangeCode(s.access, { grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
  assert.equal(token.token_type, 'Bearer');
  const key = await s.access.agentFromHeader(`Bearer ${token.access_token}`);
  assert.equal(key?.shopId, 'shop_maya');
  assert.equal(key?.label, 'Claude');

  await assert.rejects(exchangeCode(s.access, { grant_type: 'authorization_code', code, client_id: registered.client_id, code_verifier: verifier }), /already used/);
  await assert.rejects(exchangeCode(s.access, { grant_type: 'refresh_token', refresh_token: 'x' }), (e: OAuthError) => e.code === 'unsupported_grant_type');
});

test('requests that must not go through', async () => {
  const s = await stack();
  const { client_id } = registerClient(s.access, { client_name: 'ChatGPT', redirect_uris: [CALLBACK] });

  // Never redirect to an address the app didn't register, or for an app Sayso didn't register.
  assert.throws(() => checkAuthorize(s.access, site, authorizeParams(client_id, { redirect_uri: 'https://evil.example/cb' })), OAuthError);
  assert.throws(() => checkAuthorize(s.access, site, authorizeParams('made-up-client')), OAuthError);
  assert.throws(() => checkAuthorize(s.access, site, authorizeParams(client_id.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))), OAuthError, 'a client id is signed');

  // Nor for any other mistake: anyone can register an app with any https address, so nothing is sent
  // back to it before the owner answers (no open redirect through Sayso's domain).
  const bad = (extra: Record<string, string>, code: string) => assert.throws(() => checkAuthorize(s.access, site, authorizeParams(client_id, extra)), (e: OAuthError) => e.code === code);
  bad({ code_challenge_method: 'plain' }, 'invalid_request');
  bad({ response_type: 'token' }, 'unsupported_response_type');
  bad({ resource: 'https://sayso.test/api/shopping/mcp' }, 'invalid_target');
  bad({ scope: 'admin' }, 'invalid_scope');

  // The owner says no.
  assert.equal(new URL(deny(site, checkAuthorize(s.access, site, authorizeParams(client_id)))).searchParams.get('error'), 'access_denied');

  // Registration: https, or http back to this computer only; public clients only.
  assert.throws(() => registerClient(s.access, { redirect_uris: ['http://evil.example/cb'] }), OAuthError);
  assert.throws(() => registerClient(s.access, { redirect_uris: ['https://x.example/cb#frag'] }), OAuthError);
  assert.throws(() => registerClient(s.access, { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }), OAuthError);
  assert.ok(registerClient(s.access, { redirect_uris: ['http://localhost:3118/callback'] }).client_id);
  assert.equal(unpackRequest(s.access, 'not-a-real-request-token-at-all'), undefined);
});

test('token requests: form or JSON, string fields only', () => {
  assert.deepEqual(parseTokenRequest('application/x-www-form-urlencoded', 'grant_type=authorization_code&code=abc'), { grant_type: 'authorization_code', code: 'abc' });
  assert.deepEqual(parseTokenRequest('application/json', '{"code":{"$ne":1},"grant_type":"authorization_code"}'), { grant_type: 'authorization_code' }, 'non-strings are dropped');
  assert.throws(() => parseTokenRequest('application/json', '{nope'), (e: OAuthError) => e.code === 'invalid_request');
});
