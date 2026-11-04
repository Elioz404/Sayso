// What the OAuth routes share: open CORS (apps call the token and registration endpoints from their own
// servers, and some from a browser), no caching, and RFC 6749 error bodies.
import 'server-only';
import { OAuthError } from '@/core/oauth.ts';
import { handle } from './http.ts';

export const OAUTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
};

export async function oauthJson(fn: () => Promise<Response>): Promise<Response> {
  const response = await handle(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof OAuthError) return Response.json(err.body(), { status: err.status });
      throw err;
    }
  });
  for (const [k, v] of Object.entries(OAUTH_CORS)) response.headers.set(k, v);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function oauthOptions(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
