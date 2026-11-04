// Save a new passkey: POST { token, credential, label?, proof? }. The first passkey needs a fresh
// sign-in; later ones need that or `proof`, a confirmation ("add-passkey") from one the shop has.
import { PROOF_SCHEMA, REGISTRATION_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const NEW_PASSKEY = {
  type: 'object',
  properties: { token: { type: 'string', maxLength: 300 }, credential: REGISTRATION_SCHEMA, label: { type: 'string', maxLength: 60 }, proof: PROOF_SCHEMA },
  required: ['token', 'credential'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireOwnShop(request);
    const { token, credential, label, proof } = await readBody(request, NEW_PASSKEY);
    const { passkeys, access } = await ready();
    const saved = await passkeys.register(session.shopId, token, credential, label ?? '', { freshSignIn: access.isFresh(session), proof });
    return Response.json({ id: saved.id, label: saved.label });
  });
}
