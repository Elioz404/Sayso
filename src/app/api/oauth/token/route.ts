// RFC 6749 token endpoint: the code the owner's OK produced, with its PKCE verifier, for an agent key named
// after the app. Form-encoded as the spec says (JSON is accepted too); bodies are capped and rate limited.
import { exchangeCode, OAuthError, parseTokenRequest } from '@/core/oauth.ts';
import { RateLimit } from '@/core/rate-limit.ts';
import { ready } from '@/server/context.ts';
import { readText } from '@/server/http.ts';
import { oauthJson, oauthOptions } from '@/server/oauth-route.ts';
import { clientAddress } from '@/server/rate-limit.ts';

/** Token requests per address per hour: an app trades one code per connection. */
const exchanges = new RateLimit(60, 3_600_000);

export async function POST(request: Request) {
  return oauthJson(async () => {
    if (!exchanges.allow(clientAddress(request))) throw new OAuthError('slow_down', 'Too many token requests from here; try again later', 429);
    const form = parseTokenRequest(request.headers.get('content-type') ?? '', await readText(request, 16 * 1024));
    return Response.json(await exchangeCode((await ready()).access, form));
  });
}
export const OPTIONS = oauthOptions;
