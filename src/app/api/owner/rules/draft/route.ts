// POST { text }: draft new rules from the owner's own words, without saving them. The answer shows them per
// action, lists what could not become a rule, and carries a signed token (30 minutes) to save exactly this
// draft with POST /api/owner/rules. `version` is what a passkey confirms ("rules:<version>").
import { rulesByAction } from '@/core/guard/rules-by-action.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const DRAFT = { type: 'object', properties: { text: { type: 'string', minLength: 3, maxLength: 2_000 } }, required: ['text'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { text } = await readBody(request, DRAFT);
    const { saySo } = await ready();
    const { policy, unclear, token, version } = await saySo.draftRules(shopId, text);
    return Response.json({ token, version, rows: rulesByAction(policy), unclear });
  });
}
