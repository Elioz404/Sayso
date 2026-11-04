// The owner adopts a rule their own approvals earned: POST { passkey? }. It applies at once, through
// Guard and its audit; once the shop has a passkey, it is confirmed with it ("adopt-rule:<id>").
// The shared public demo keeps its rules, so every visitor sees the same shop.
import { ownerActor } from '@/core/actors.ts';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const ADOPT = { type: 'object', properties: { passkey: PROOF_SCHEMA } } as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { passkey } = await readBody(request, ADOPT);
    const record = await (await ready()).saySo.adoptSuggestion(shopId, (await params).id, ownerActor(shopId), passkey);
    return Response.json({ status: record.status, say_so_id: record.id });
  });
}
