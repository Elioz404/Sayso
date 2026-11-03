// The owner's own PayPal for payouts. POST: a PayPal link to connect it (the browser goes there).
// DELETE: stop paying new sales into it. Owner session only; the shared demo can't connect anything.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, ownerSession, requireOwner } from '@/server/http.ts';

async function owner(request: Request): Promise<string> {
  const shopId = await requireOwner(request);
  if ((await ownerSession())?.kind === 'demo') throw new HttpError(403, 'The shared demo shop is paid into the demo account.');
  return shopId;
}

export async function POST(request: Request) {
  return handle(async () => Response.json({ url: await (await ready()).payouts.connectLink(await owner(request)) }));
}

export async function DELETE(request: Request) {
  return handle(async () => {
    await (await ready()).payouts.disconnect(await owner(request));
    return Response.json({ ok: true });
  });
}
