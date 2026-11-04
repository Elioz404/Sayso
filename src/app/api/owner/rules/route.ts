// POST { token, passkey? }: the owner saves the rules they drafted with /api/owner/rules/draft and read. It
// goes through Guard as a rule change (audited); once the shop has a passkey, it is confirmed with it. The
// shared demo keeps its rules.
import { ownerActor } from '@/core/actors.ts';
import { HttpError } from '@/core/errors.ts';
import type { Policy } from '@/core/guard/policy.ts';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';
import { RULES_DRAFT } from '@/server/owner.ts';

const SAVE = { type: 'object', properties: { token: { type: 'string', maxLength: 20_000 }, passkey: PROOF_SCHEMA }, required: ['token'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { token, passkey } = await readBody(request, SAVE);
    const { access, saySo } = await ready();
    const value = access.verifyValue(RULES_DRAFT, token);
    if (!value) throw new HttpError(410, 'This draft is more than 30 minutes old; draft it again');
    const policy = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Policy;
    const record = await saySo.saveRules(shopId, policy, ownerActor(shopId), passkey);
    if (record.status !== 'verified') throw new HttpError(409, record.status === 'failed' ? 'Your rules changed while you were writing these; draft them again' : `Not saved (${record.status})`);
    return Response.json({ status: record.status, say_so_id: record.id });
  });
}
