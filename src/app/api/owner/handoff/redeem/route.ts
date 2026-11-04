// The phone opens the shop: POST { token } from the /handoff page (a button press, never a plain link
// visit, so a link preview or someone else's link can't sign a browser in by itself). Each token works
// once and the session it opens ends when the one that made it does.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody, startOwnerSession } from '@/server/http.ts';

const REDEEM = { type: 'object', properties: { token: { type: 'string', maxLength: 300 } }, required: ['token'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { token } = await readBody(request, REDEEM);
    const opened = await (await ready()).access.redeemHandoff(token);
    if (!opened) throw new HttpError(410, 'That code expired or was already used. Show a fresh one on the device you signed in on.');
    await startOwnerSession(opened.shopId, { via: 'handoff', expires: new Date(opened.expiresAt) });
    return Response.json({ ok: true });
  });
}
