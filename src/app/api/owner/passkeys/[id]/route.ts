// Remove a passkey: DELETE { proof }, a signature from any of the shop's passkeys.
import type { PasskeyProof } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice } from '@/server/http.ts';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const { proof } = await readJson<{ proof: PasskeyProof }>(request);
    await (await ready()).passkeys.remove(shopId, decodeURIComponent((await params).id), proof);
    return Response.json({ ok: true });
  });
}
