// Save a new passkey: POST { token, credential, label, proof? }. Once the shop has a passkey, adding
// another needs `proof`: a signature from one it already has.
import type { PasskeyProof } from '@/core/passkeys.ts';
import type { RegistrationCredential } from '@/core/webauthn.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const { token, credential, label, proof } = await readJson<{ token: string; credential: RegistrationCredential; label?: string; proof?: PasskeyProof }>(request);
    const saved = await (await ready()).passkeys.register(shopId, String(token ?? ''), credential, typeof label === 'string' ? label : '', proof);
    return Response.json({ id: saved.id, label: saved.label });
  });
}
