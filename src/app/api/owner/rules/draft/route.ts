// POST { text }: draft new rules from the owner's own words, without saving them. The answer shows them per
// action, lists what could not become a rule, and carries a signed token (30 minutes) to save exactly this
// draft with POST /api/owner/rules. `version` is what a passkey confirms ("rules:<version>").
import { rulesByAction } from '@/core/guard/rules-by-action.ts';
import { policyVersion } from '@/core/guard/policy-store.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';
import { RULES_DRAFT } from '@/server/owner.ts';

const DRAFT = { type: 'object', properties: { text: { type: 'string', minLength: 3, maxLength: 2_000 } }, required: ['text'] } as const;

const DRAFT_TTL_MS = 30 * 60_000;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { text } = await readBody(request, DRAFT);
    const { saySo, access } = await ready();
    const { policy, unclear } = await saySo.draftRules(shopId, text);
    const token = access.signValue(RULES_DRAFT, Buffer.from(JSON.stringify(policy)).toString('base64url'), DRAFT_TTL_MS);
    return Response.json({ token, version: policyVersion(policy), rows: rulesByAction(policy), unclear });
  });
}
