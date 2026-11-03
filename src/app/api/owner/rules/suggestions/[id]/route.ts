// The owner adopts a rule their own approvals earned: it applies at once, through Guard and its audit.
// The shared public demo keeps its rules, so every visitor sees the same shop.
import { ownerActor } from '@/core/actors.ts';
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, ownerSession, requireOwner } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    if ((await ownerSession())?.kind === 'demo') throw new HttpError(403, "The shared demo shop's rules stay as they are. Start the judges' tour for a copy of your own.");
    const record = await (await ready()).saySo.adoptSuggestion(shopId, (await params).id, ownerActor(shopId));
    return Response.json({ status: record.status, say_so_id: record.id });
  });
}
