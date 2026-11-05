// The owner's answer on the consent page: POST { request, decision: "allow" | "deny", proof? } -> { location },
// where the page then goes (the app's registered address, with a one-time code or access_denied). Sent
// with fetch, not a form: the site's CSP keeps form posts on this origin. Allowing gives the app an agent
// key, so it needs the same step-up as making one by hand: a recent sign-in on this device, or the passkey.
import { HttpError } from '@/core/errors.ts';
import { allow, deny, unpackRequest } from '@/core/oauth.ts';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';
import { requireStepUp } from '@/server/owner.ts';

const ANSWER = {
  type: 'object',
  properties: { request: { type: 'string', maxLength: 8000 }, decision: { type: 'string', enum: ['allow', 'deny'] }, proof: PROOF_SCHEMA },
  required: ['request', 'decision'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireOwnShop(request);
    const body = await readBody(request, ANSWER);
    const { access, links } = await ready();
    const consent = unpackRequest(access, body.request);
    if (!consent) throw new HttpError(410, 'This request expired. Start again from the app.');
    if (body.decision === 'deny') return Response.json({ location: deny(links, consent) });
    await requireStepUp(session, body.proof, 'agent-key');
    return Response.json({ location: allow(access, links, consent, session.shopId) });
  });
}
