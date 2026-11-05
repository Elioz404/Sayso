// POST { token, passkey? }: the owner saves the rules they drafted with /api/owner/rules/draft and read. It
// goes through Guard as a rule change (audited); once the shop has a passkey, it is confirmed with it.
import { ownerActor } from '@/core/actors.ts';
import { HttpError } from '@/core/errors.ts';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const SAVE = { type: 'object', properties: { token: { type: 'string', maxLength: 20_000 }, passkey: PROOF_SCHEMA }, required: ['token'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { token, passkey } = await readBody(request, SAVE);
    const { saySo } = await ready();
    const record = await saySo.saveRules(shopId, token, ownerActor(shopId), passkey);
    if (record.status !== 'verified') throw new HttpError(409, record.simulation?.blockers[0] ?? record.verification?.detail ?? `Not saved (${record.status})`);
    return Response.json({ status: record.status, say_so_id: record.id });
  });
}
