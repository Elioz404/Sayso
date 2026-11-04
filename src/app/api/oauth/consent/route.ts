// The owner's answer on the consent page (a plain form POST): allow sends the app a one-time code, cancel
// sends it access_denied. Only the shop's own owner session can allow; the shared demo can't.
import { HttpError } from '@/core/errors.ts';
import { allow, deny, unpackRequest } from '@/core/oauth.ts';
import { ready } from '@/server/context.ts';
import { handle, requireOwnShop } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const form = await request.formData();
    const { access, links } = await ready();
    const consent = unpackRequest(access, String(form.get('request') ?? ''));
    if (!consent) throw new HttpError(410, 'This request expired. Start again from the app.');
    const target = form.get('decision') === 'allow' ? allow(access, links, consent, shopId) : deny(links, consent);
    return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
  });
}
