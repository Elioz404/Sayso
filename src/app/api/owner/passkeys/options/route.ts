// What the browser needs to make or use a passkey. POST one of:
//   { "purpose": "register" }                               make a passkey on this device
//   { "purpose": "approve", "record": "<say-so id>" }       sign the decision on one request
//   { "purpose": "confirm", "what": "<confirmation>" }      confirm one change: "add-passkey",
//                                                           "remove-passkey:<id>", "adopt-rule:<id>", "rules:<version>",
//                                                           "phone-link"
// The answer carries a signed, single-use token to send back with the passkey's reply.
import { HttpError } from '@/core/errors.ts';
import type { Confirmation } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwner, requireOwnShop } from '@/server/http.ts';

const ASK = {
  type: 'object',
  properties: {
    purpose: { type: 'string', enum: ['register', 'approve', 'confirm'] },
    record: { type: 'string', maxLength: 40 },
    what: { type: 'string', maxLength: 120, pattern: '^(add-passkey|phone-link|remove-passkey:[A-Za-z0-9_-]{1,1400}|adopt-rule:[A-Za-z0-9_.:-]{1,100}|rules:[a-f0-9]{16})$' },
  },
  required: ['purpose'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, ASK);
    const { passkeys, saySo, shops } = await ready();
    if (body.purpose === 'approve') {
      // Deciding works in any owner session; the record must be one of this shop's.
      const shopId = await requireOwner(request);
      if (!body.record) throw new HttpError(400, 'Which request? Send "record"');
      return Response.json(await passkeys.approvalOptions(shopId, await saySo.record(shopId, body.record)));
    }
    const { shopId } = await requireOwnShop(request);
    if (body.purpose === 'confirm') {
      if (!body.what) throw new HttpError(400, 'Confirm what? Send "what"');
      return Response.json(await passkeys.confirmationOptions(shopId, body.what as Confirmation));
    }
    return Response.json(await passkeys.registrationOptions(shopId, (await shops.get(shopId)).shop.name));
  });
}
