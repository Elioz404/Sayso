// Remove a passkey: DELETE { proof? }. Needs a fresh sign-in, or `proof`: a confirmation
// ("remove-passkey:<id>") from any of the shop's passkeys.
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const REMOVE = { type: 'object', properties: { proof: PROOF_SCHEMA } } as const;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireOwnShop(request);
    const { proof } = await readBody(request, REMOVE);
    const { passkeys, access } = await ready();
    await passkeys.remove(session.shopId, decodeURIComponent((await params).id), { freshSignIn: access.isFresh(session), proof });
    return Response.json({ ok: true });
  });
}
