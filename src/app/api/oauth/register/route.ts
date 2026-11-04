// RFC 7591 dynamic client registration: an AI app (ChatGPT, Claude...) registers itself before sending the
// owner to allow it. Nothing is stored: the client id is the signed registration.
import { OAuthError, registerClient } from '@/core/oauth.ts';
import { RateLimit } from '@/core/rate-limit.ts';
import { ready } from '@/server/context.ts';
import { readJson } from '@/server/http.ts';
import { oauthJson, oauthOptions } from '@/server/oauth-route.ts';
import { clientAddress } from '@/server/rate-limit.ts';

/** Registrations per address per hour: an app registers once per connection. */
const registrations = new RateLimit(30, 3_600_000);

export async function POST(request: Request) {
  return oauthJson(async () => {
    if (!registrations.allow(clientAddress(request))) throw new OAuthError('slow_down', 'Too many registrations from here; try again later', 429);
    const body = await readJson(request).catch(() => {
      throw new OAuthError('invalid_client_metadata', 'Send the registration as JSON');
    });
    return Response.json(registerClient((await ready()).access, body), { status: 201 });
  });
}
export const OPTIONS = oauthOptions;
