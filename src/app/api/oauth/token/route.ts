// RFC 6749 token endpoint: the code the owner's OK produced, with its PKCE verifier, for an agent key named
// after the app. Form-encoded as the spec says (JSON is accepted too).
import { exchangeCode } from '@/core/oauth.ts';
import { ready } from '@/server/context.ts';
import { oauthJson, oauthOptions } from '@/server/oauth-route.ts';

export async function POST(request: Request) {
  return oauthJson(async () => {
    const type = request.headers.get('content-type') ?? '';
    const text = (await request.text()).slice(0, 16_000);
    let form: Record<string, string | undefined> = {};
    if (type.includes('application/json')) {
      try {
        form = JSON.parse(text) as Record<string, string>;
      } catch {
        form = {};
      }
    } else {
      form = Object.fromEntries(new URLSearchParams(text));
    }
    return Response.json(await exchangeCode((await ready()).access, form));
  });
}
export const OPTIONS = oauthOptions;
