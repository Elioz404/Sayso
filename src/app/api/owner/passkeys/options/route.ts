// What the browser needs to make or use a passkey: POST { "purpose": "register" | "manage" | "approve",
// "record"?: "<say-so id>" }. The answer carries a signed token to send back with the passkey's reply.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice, requireOwner } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { purpose, record } = await readJson<{ purpose?: string; record?: string }>(request);
    const { passkeys, saySo, shops } = await ready();
    if (purpose === 'approve') {
      // Approving works in any owner session; the record must be one of this shop's.
      const shopId = await requireOwner(request);
      return Response.json(await passkeys.assertionOptions(shopId, 'approve', await saySo.record(shopId, String(record ?? ''))));
    }
    const { shopId } = await requireOwnDevice(request);
    if (purpose === 'manage') return Response.json(await passkeys.assertionOptions(shopId, 'manage'));
    if (purpose === 'register') return Response.json(await passkeys.registrationOptions(shopId, (await shops.get(shopId)).shop.name));
    throw new HttpError(400, 'purpose must be "register", "manage" or "approve"');
  });
}
